import { BigNumber } from "ethers";
import fetch from "node-fetch";

import supportedNetworkSubgraphs from "./supportedNetworkSubgraphs";
import { INakedMarginVaults } from "../types";
import { liquidatorAccountAddress, Logger, provider } from "../../helpers";

export default async function fetchNakedMarginVaults(): Promise<INakedMarginVaults> {
  const networkChainId = (await provider.getNetwork()).chainId.toString();

  const subgraphUrl = supportedNetworkSubgraphs[networkChainId];

  if (!subgraphUrl) {
    Logger.error({
      at: "VaultStore#fetchNakedMarginVaults",
      message: "Warning: No subgraph for detected Ethereum network",
      supportedNetworkSubgraphChainIds: Object.keys(supportedNetworkSubgraphs),
    });
    return {};
  }

  const nakedMarginVaultQuery = JSON.stringify({
    query: `
      {
        vaults(where: { owner_not: "${liquidatorAccountAddress.toLowerCase()}" type: 1 }) {
          owner {
            address: id
            }
          vaultId
        }
      }`,
  });

  try {
    const {
      data: { vaults },
    } = await (
      await fetch(subgraphUrl, {
        body: nakedMarginVaultQuery,
        method: "POST",
      })
    ).json();

    const nakedMarginVaults: INakedMarginVaults = vaults.reduce(
      (
        nakedMarginVaults: INakedMarginVaults,
        {
          owner: { address },
          vaultId,
        }: { owner: { address: string }; vaultId: string }
      ) => {
        if (!nakedMarginVaults[address]) nakedMarginVaults[address] = [];
        return {
          ...nakedMarginVaults,
          [address]: [
            ...nakedMarginVaults[`${address}`],
            BigNumber.from(vaultId),
          ],
        };
      },
      {}
    );

    return nakedMarginVaults;
  } catch (error) {
    Logger.error({
      at: "VaultStore#fetchNakedMarginVaults",
      message: error.message,
      subgraphUrl,
      nakedMarginVaultQuery,
      error,
    });
    return {};
  }
}
