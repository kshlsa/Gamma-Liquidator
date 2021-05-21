// minimal contract ABI needed for price feed updates
const chainlinkAggregatorABI = [
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)",
  "function aggregator() external view returns (address)",
  "function latestRoundData() public view override returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

export default chainlinkAggregatorABI;
