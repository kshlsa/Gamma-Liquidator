import Liquidator from "../../index";
import { gammaControllerProxyContract, Logger } from "../../../helpers";

export default async function fetchLiquidatableVaults(Liquidator: Liquidator) {
  const nakedMarginVaults = Liquidator.vaultStore.getNakedMarginVaults();
  const vaultOwnerAddresses = Object.keys(nakedMarginVaults);

  for (const vaultOwnerAddress of vaultOwnerAddresses) {
    await Promise.all(
      nakedMarginVaults[vaultOwnerAddress].map(async (vaultId) => {
        try {
          const [vaultDetails] = await gammaControllerProxyContract.getVault(
            vaultOwnerAddress,
            vaultId
          );

          if (!vaultDetails) return;

          // currently only one vault per vaultId
          // here we check if the vault is no longer short
          if (vaultDetails.shortAmounts[0].eq(0)) return;

          // currently only one collateralAsset address per vault
          const collateralAssetAddress = vaultDetails.collateralAssets[0];
          // currently only one short position per vault
          const shortAmount = vaultDetails.shortAmounts[0];
          // currently only one shortOtoken address per vault
          const shortOtokenAddress = vaultDetails.shortOtokens[0];

          const { answer, roundId } =
            Liquidator.priceFeedStore.getLatestRoundData();

          const [isUnderCollateralized, currentRoundIdCalculatedAuctionPrice] =
            await gammaControllerProxyContract.isLiquidatable(
              vaultOwnerAddress,
              vaultId,
              roundId
            );

          if (!isUnderCollateralized) return;

          if (Liquidator.liquidatableVaults[vaultOwnerAddress]) {
            let vaultPresent = false;
            await Promise.all(
              Liquidator.liquidatableVaults[vaultOwnerAddress].map(
                async (vault) => {
                  if (vaultId.eq(vault.vaultId)) {
                    vaultPresent = true;

                    if (!roundId.eq(vault.roundId)) {
                      const [, oldRoundIdRecalculatedAuctionPrice] =
                        await gammaControllerProxyContract.isLiquidatable(
                          vaultOwnerAddress,
                          vaultId,
                          vault.roundId
                        );

                      if (
                        currentRoundIdCalculatedAuctionPrice.gt(
                          oldRoundIdRecalculatedAuctionPrice
                        )
                      ) {
                        vault.latestAuctionPrice =
                          currentRoundIdCalculatedAuctionPrice;
                        vault.roundId = roundId;
                      } else {
                        vault.latestAuctionPrice =
                          oldRoundIdRecalculatedAuctionPrice;
                      }
                    }
                  }
                }
              )
            );
            if (!vaultPresent) {
              Liquidator.liquidatableVaults[vaultOwnerAddress].push({
                latestAuctionPrice: currentRoundIdCalculatedAuctionPrice,
                latestUnderlyingAssetPrice: answer,
                collateralAssetAddress,
                roundId,
                shortAmount,
                shortOtokenAddress,
                vaultId,
              });
            }
          } else {
            Liquidator.liquidatableVaults[vaultOwnerAddress] = [
              {
                latestAuctionPrice: currentRoundIdCalculatedAuctionPrice,
                latestUnderlyingAssetPrice: answer,
                collateralAssetAddress,
                roundId,
                shortAmount,
                shortOtokenAddress,
                vaultId,
              },
            ];
          }
        } catch (error) {
          Logger.error({
            at: "Liquidator#_fetchLiquidatableVaults",
            message: error.message,
            error,
          });
        }
      })
    );
  }
}
