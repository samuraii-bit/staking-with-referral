// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/interfaces/draft-IERC1822.sol";

/**
 * @title IStaking
 * @dev Interface for Staking Contract with upgradeable functionality
 */
interface IStaking is IERC165 {
    struct StakeInfo {
        uint256 balance;
        uint256 stakeTimestamp;
        uint256 lastClaimTimestamp;
    }

    function initialize(address admin) external;
    function deposit(address token, uint256 amount) external;
    function setRefer(address referral, address token) external;
    function claim(address token) external;
    function unstake(address token) external;

    function calculateCurrentReward(address user, address token)
        external
        view
    returns (uint256 amountToClaim, uint256 fullCyclesPassed);

    function setNewRewardRate(uint256 newRewardRate) external;
    function setNewClaimLockTime(uint256 newClaimLockTime) external;

    function stakes(address user, address token) external view returns (StakeInfo memory);
    function referralToReferrer(address referral) external view returns (address);

    function rewardRate() external view returns (uint256);
    function claimLockTime() external view returns (uint256);
}