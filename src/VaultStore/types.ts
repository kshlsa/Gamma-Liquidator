import { BigNumber } from "ethers";

export interface ILiquidatableVault {
  latestAuctionPrice: BigNumber;
  latestUnderlyingAssetPrice: BigNumber;
  collateralAssetAddress: string;
  roundId: BigNumber;
  shortAmount: BigNumber;
  shortOtokenAddress: string;
  vaultId: BigNumber;
}

export interface ILiquidatableVaults {
  [vaultOwnerAddress: string]: ILiquidatableVault[];
}

export interface INakedMarginVaults {
  [vaultOwnerAddress: string]: BigNumber[];
}

export interface ISettleableVaults {
  [settleableVaultNonce: string]: BigNumber;
}

export interface ISettlementDetails {
  expiryTimestamp: BigNumber;
  shortAmount: BigNumber;
}

export interface ISettlementVaults {
  [shortOtokenAddress: string]: ISettlementVault;
}

export interface ISettlementVault {
  [settlementVaultNonce: string]: ISettlementDetails;
}