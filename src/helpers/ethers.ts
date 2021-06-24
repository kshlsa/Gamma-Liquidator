import { ethers } from "ethers";

import chainlinkAggregatorABI from "./chainlinkAggregatorABI";
import gammaControllerABI from "./gammaControllerABI";
import Logger from "./logger";

export const provider = new ethers.providers.JsonRpcProvider(
  process.env.ETHEREUM_NODE_URL
);

export const chainlinkAggregatorProxyContract = new ethers.Contract(
  process.env.CHAINLINK_PRICE_FEED_ADDRESS as string,
  chainlinkAggregatorABI,
  provider
);

export let gammaControllerProxyContract = new ethers.Contract(
  process.env.GAMMA_CONTROLLER_ADDRESS as string,
  gammaControllerABI,
  provider
);

if (!process.env.BOT_PRIVATE_KEY) {
  Logger.error({
    at: "ethers#loadLiquidatorAccount",
    message: "BOT_PRIVATE_KEY is not provided",
    error: Error("BOT_PRIVATE_KEY is not provided"),
  });
}

export const liquidatorAccount = new ethers.Wallet(
  process.env.BOT_PRIVATE_KEY as string,
  provider
);

export const liquidatorAccountAddress = liquidatorAccount.address;

export const collateralCustodianAddress = process.env
  .COLLATERAL_CUSTODIAN_ADDRESS
  ? process.env.COLLATERAL_CUSTODIAN_ADDRESS
  : liquidatorAccountAddress;

export async function loadLiquidatorAccount(): Promise<void> {
  gammaControllerProxyContract =
    gammaControllerProxyContract.connect(liquidatorAccount);

  const liquidatorAddress = liquidatorAccount.address.toLowerCase();

  Logger.info({
    at: "ethers#loadLiquidatorAccount",
    message: "Loaded liquidator account",
    address: liquidatorAddress,
  });
}
