import { BigNumber } from "ethers";

import liquidateVault from "./liquidateVault";
import prepareCallCollateral from "./prepareCallCollateral";
import setLiquidationVaultNonce from "./setLiquidationVaultNonce";
import slackWebhook from "./slackWebhook";
import {
  calculateLiquidationTransactionCost,
  fetchCollateralAssetDecimals,
  fetchDeribitBestAskPrice,
  fetchDeribitDelta,
  fetchDeribitMarkPrice,
  fetchShortOtokenInstrumentInfo,
  marginCalculatorContract,
  setLatestLiquidatorVaultNonce,
} from "../";
import { checkCollateralAssetBalance } from "../balances";
import Liquidator from "../../index";
import { Logger } from "../../../helpers";

export default async function attemptLiquidations(
  liquidatableVaultOwners: string[],
  liquidatableVaults: Liquidator["vaultStore"]["liquidatableVaults"],
  Liquidator: Liquidator
): Promise<void> {
  const underlyingAsset = Liquidator.priceFeedStore.getUnderlyingAsset();

  for await (const liquidatableVaultOwner of liquidatableVaultOwners) {
    for await (const vault of liquidatableVaults[liquidatableVaultOwner]) {
      try {
        const shortOtokenInstrumentInfo = await fetchShortOtokenInstrumentInfo(
          vault.shortOtokenAddress
        );

        const isPutOption = shortOtokenInstrumentInfo.optionType === "P";

        const collateralAssetDecimals: any = await fetchCollateralAssetDecimals(
          vault.collateralAssetAddress
        );

        vault.collateralAmount = BigNumber.from(vault.collateralAmount);
        vault.latestAuctionPrice = BigNumber.from(vault.latestAuctionPrice);
        vault.latestUnderlyingAssetPrice = BigNumber.from(
          vault.latestUnderlyingAssetPrice
        );
        vault.roundId = BigNumber.from(vault.roundId);
        vault.shortAmount = BigNumber.from(vault.shortAmount);
        vault.vaultId = BigNumber.from(vault.vaultId);

        let optionExistsOnDeribit = true,
          calculatedDeribitPrice = 0;

        try {
          // returned in underlying
          let deribitBestAskPrice = await fetchDeribitBestAskPrice({
            ...shortOtokenInstrumentInfo,
            underlyingAsset,
          });

          deribitBestAskPrice =
            (deribitBestAskPrice *
              vault.latestUnderlyingAssetPrice.toNumber()) /
            10 ** 8;

          // returned in underlying
          const deribitDelta = await fetchDeribitDelta({
            ...shortOtokenInstrumentInfo,
            underlyingAsset,
          });

          const calculatedMaxSpread =
            Number(process.env.DERIBIT_MAX_SPREAD_MULTIPLIER) *
            Math.max(
              Number(process.env.DERIBIT_MIN_SPREAD),
              Number(process.env.DERIBIT_MAX_SPREAD) * deribitDelta
            );

          // returned in underlying
          const deribitMarkPrice = await fetchDeribitMarkPrice({
            ...shortOtokenInstrumentInfo,
            underlyingAsset,
          });

          let calculatedMarkPrice =
            deribitMarkPrice * (calculatedMaxSpread / 2);

          calculatedMarkPrice =
            (calculatedMarkPrice *
              vault.latestUnderlyingAssetPrice.toNumber()) /
            10 ** 8;

          if (deribitBestAskPrice === 0) {
            deribitBestAskPrice = calculatedMarkPrice;
          }

          calculatedDeribitPrice = Math.min(
            calculatedMarkPrice,
            deribitBestAskPrice
          );
        } catch (error) {
          if (error.message.includes("best_ask_price")) {
            optionExistsOnDeribit = false;
          } else {
            Logger.error({
              alert: "Critical error when fetching Deribit best ask price",
              at: "Liquidator#attemptLiquidations",
              message: error.message,
              ...shortOtokenInstrumentInfo,
              underlyingAsset,
              error,
            });

            return;
          }
        }

        let [, collateralAssetMarginRequirement]: any =
          await marginCalculatorContract.getMarginRequired(
            {
              collateralAmounts: [vault.collateralAmount],
              collateralAssets: [vault.collateralAssetAddress],
              longAmounts: [],
              longOtokens: [],
              shortAmounts: [vault.shortAmount],
              shortOtokens: [vault.shortOtokenAddress],
            },
            0
          );

        collateralAssetMarginRequirement =
          (collateralAssetMarginRequirement / 1e27) *
          10 ** collateralAssetDecimals;

        await checkCollateralAssetBalance(
          collateralAssetMarginRequirement,
          collateralAssetDecimals,
          liquidatableVaultOwner,
          vault
        );

        const liquidatorVaultNonce = await setLiquidationVaultNonce(Liquidator);

        if (!optionExistsOnDeribit) {
          if (
            vault.latestAuctionPrice
              .mul(vault.shortAmount)
              .div(vault.collateralAmount)
              .toNumber() /
              1e8 >
            Number(process.env.MINIMUM_COLLATERAL_TO_LIQUIDATE_FOR)
          ) {
            if (isPutOption) {
              return await liquidateVault(Liquidator, {
                collateralToDeposit: collateralAssetMarginRequirement,
                liquidatorVaultNonce,
                vault,
                vaultOwnerAddress: liquidatableVaultOwner,
              });
            } else {
              // call option
              await prepareCallCollateral(Liquidator, {
                collateralAssetDecimals,
                collateralAssetMarginRequirement,
                vaultLatestUnderlyingAssetPrice:
                  vault.latestUnderlyingAssetPrice,
              });

              return await liquidateVault(Liquidator, {
                collateralToDeposit: collateralAssetMarginRequirement,
                liquidatorVaultNonce,
                vault,
                vaultOwnerAddress: liquidatableVaultOwner,
              });
            }
          }

          return;
        }

        const estimatedLiquidationTransactionCost =
          await calculateLiquidationTransactionCost({
            collateralToDeposit: collateralAssetMarginRequirement,
            gasPriceStore: Liquidator.gasPriceStore,
            liquidatorVaultNonce,
            vault,
            vaultOwnerAddress: liquidatableVaultOwner,
          });

        const estimatedTotalCostToLiquidateInUSD =
          ((calculatedDeribitPrice +
            Math.max(
              Number(process.env.DERIBIT_PRICE_MULTIPLIER) *
                calculatedDeribitPrice,
              Number(process.env.MINIMUM_LIQUIDATION_PRICE)
            )) *
            vault.shortAmount.toNumber()) /
            10 ** 8 +
          estimatedLiquidationTransactionCost;

        if (isPutOption) {
          if (
            ((vault.latestAuctionPrice.toNumber() /
              10 ** collateralAssetDecimals) *
              vault.shortAmount.toNumber()) /
              10 ** 8 >
            estimatedTotalCostToLiquidateInUSD
          ) {
            return await liquidateVault(Liquidator, {
              collateralToDeposit: collateralAssetMarginRequirement,
              liquidatorVaultNonce,
              vault,
              vaultOwnerAddress: liquidatableVaultOwner,
            });
          }

          if (process.env.MONITOR_SYSTEM_SOLVENCY) {
            if (
              estimatedTotalCostToLiquidateInUSD >
              vault.collateralAmount.toNumber() / 10 ** collateralAssetDecimals
            ) {
              await slackWebhook.send({
                text: `\nWarning: Vault insolvent. Not profitable to liquidate.\n\nvaultOwner: ${liquidatableVaultOwner}\nvaultId: ${vault.vaultId.toString()}\nestimated total cost to liquidate (denominated in USD): $${estimatedTotalCostToLiquidateInUSD}\nvault collateral value (denominated in USD): $${
                  vault.collateralAmount.toNumber() /
                  10 ** collateralAssetDecimals
                }\nput vault: true`,
              });
            }
          }

          return await setLatestLiquidatorVaultNonce(Liquidator);
        } else {
          // call option
          if (
            ((((vault.latestAuctionPrice.toNumber() /
              10 ** collateralAssetDecimals) *
              vault.shortAmount.toNumber()) /
              10 ** 8) *
              vault.latestUnderlyingAssetPrice.toNumber()) /
              10 ** 8 >
            estimatedTotalCostToLiquidateInUSD
          ) {
            await prepareCallCollateral(Liquidator, {
              collateralAssetDecimals,
              collateralAssetMarginRequirement,
              vaultLatestUnderlyingAssetPrice: vault.latestUnderlyingAssetPrice,
            });

            return await liquidateVault(Liquidator, {
              collateralToDeposit: collateralAssetMarginRequirement,
              liquidatorVaultNonce,
              vault,
              vaultOwnerAddress: liquidatableVaultOwner,
            });
          }

          if (process.env.MONITOR_SYSTEM_SOLVENCY) {
            if (
              estimatedTotalCostToLiquidateInUSD >
              ((vault.collateralAmount.toNumber() /
                10 ** collateralAssetDecimals) *
                vault.latestUnderlyingAssetPrice.toNumber()) /
                10 ** 8
            ) {
              await slackWebhook.send({
                text: `\nWarning: Vault insolvent. Not profitable to liquidate.\n\nvaultOwner: ${liquidatableVaultOwner}\nvaultId: ${vault.vaultId.toString()}\nestimated total cost to liquidate (denominated in USD): $${estimatedTotalCostToLiquidateInUSD}\nvault collateral value (denominated in USD): $${
                  ((vault.collateralAmount.toNumber() /
                    10 ** collateralAssetDecimals) *
                    vault.latestUnderlyingAssetPrice.toNumber()) /
                  10 ** 8
                }\nput vault: false`,
              });
            }
          }

          return await setLatestLiquidatorVaultNonce(Liquidator);
        }
      } catch (error) {
        Logger.error({
          alert: "Critical error during liquidation attempt",
          at: "Liquidator#attemptLiquidations",
          message: error.message,
          liquidatableVaultOwner,
          vault: {
            latestAuctionPrice: vault.latestAuctionPrice.toString(),
            latestUnderlyingAssetPrice:
              vault.latestUnderlyingAssetPrice.toString(),
            collateralAssetAddress: vault.collateralAssetAddress,
            roundId: vault.roundId.toString(),
            shortAmount: vault.shortAmount.toString(),
            shortOtokenAddress: vault.shortOtokenAddress,
            vaultId: vault.vaultId.toString(),
          },
          error,
        });

        return await setLatestLiquidatorVaultNonce(Liquidator);
      }
    }
  }
}
