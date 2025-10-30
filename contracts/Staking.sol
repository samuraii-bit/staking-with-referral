// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./interfaces/IStaking.sol";

contract Staking is IStaking, UUPSUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable{
  using SafeERC20 for IERC20;
  bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

  /// @custom:storage-location erc7201:Xyber.storage.XyberTrustManagementRouter.Main
  struct Main {
    uint256 rewardRate; // public
    uint256 claimLockTime; // public
    
    mapping(address user => mapping(address token => StakeInfo)) stakes; // public
    mapping(address referral => address referrer) referralToReferrer; // public
  }
  
  // keccak256(abi.encode(uint256(keccak256("Staking.storage")) - 1)) & ~bytes32(uint256(0xff))
  bytes32 private constant MAIN_STORAGE_LOCATION = 0x8e04e4216e265cc61b9d0ed053a57aa8164d61062108a2cb724cdb88bed1e100;
  
  event Stake(address user, address token, uint256 amount, uint256 timestamp);
  event Claim(address user, address token, uint256 amount);
  event Unstake(address user, address token);

  error Staking__ZeroValue();
  error Staking__EarlyClaim(uint256 timestamp);
  error Staking__NothingToClaim();
  error Staking__NothingToUnstake();
  error Staking__ZeroReferrerBalance();
  error Staking__NewImplementationIsInvalid(address newImplementation);
  error Staking__SelfReferringError();
  error Staking__ReferrerAlreadySetted(address referrer);
  
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }
  
  function initialize(address admin) external initializer  {
    Main storage $ = _getMainStorage();

    $.rewardRate = 10;
    $.claimLockTime = 24 hours;

    __AccessControl_init();
    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();
    _grantRole(DEFAULT_ADMIN_ROLE, admin);
    _grantRole(UPGRADER_ROLE, admin);
  }

  function deposit(address token, uint256 amount) external nonReentrant {
    Main storage $ = _getMainStorage();

    if (amount == 0) {
      revert Staking__ZeroValue();
    }
    if ($.stakes[msg.sender][token].balance > 0) {
      (uint256 amountToClaim, uint256 fullCyclesPassed) = calculateCurrentReward(msg.sender, token);
      IERC20(token).safeTransfer(msg.sender, amountToClaim);
      $.stakes[msg.sender][token].lastClaimTimestamp = block.timestamp;
    }
    if ($.referralToReferrer[msg.sender] != address(0)) {
      IERC20(token).safeTransfer($.referralToReferrer[msg.sender], ((amount * 5) / 1000));
      // $.referralToReferrer[msg.sender] = msg.sender;
    }

    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    $.stakes[msg.sender][token].balance += amount;
    $.stakes[msg.sender][token].stakeTimestamp = block.timestamp;
    $.stakes[msg.sender][token].lastClaimTimestamp = block.timestamp;

    emit Stake(msg.sender, token, amount, block.timestamp);
  }

  function claim(address token) external nonReentrant {
    Main storage $ = _getMainStorage();

    (uint256 amountToClaim, uint256 fullCyclesPassed) = calculateCurrentReward(msg.sender, token);
    
    if (fullCyclesPassed < 1) {
      revert Staking__EarlyClaim($.stakes[msg.sender][token].lastClaimTimestamp + $.claimLockTime);
    }
    if (amountToClaim == 0) {
      revert Staking__NothingToClaim();
    }
    
    IERC20(token).safeTransfer(msg.sender, amountToClaim);
    $.stakes[msg.sender][token].lastClaimTimestamp += fullCyclesPassed * $.claimLockTime;

    emit Claim(msg.sender, token, amountToClaim);
  }

  function unstake(address token) external nonReentrant {
    Main storage $ = _getMainStorage();

    if ($.stakes[msg.sender][token].balance == 0) {
      revert Staking__NothingToUnstake();
    }
    (uint256 amountToClaim, uint256 fullCyclesPassed) = calculateCurrentReward(msg.sender, token);
    IERC20(token).safeTransfer(msg.sender, amountToClaim + $.stakes[msg.sender][token].balance);
    
    $.stakes[msg.sender][token].balance = 0;
    $.stakes[msg.sender][token].stakeTimestamp = 0;
    $.stakes[msg.sender][token].lastClaimTimestamp = 0;

    emit Unstake(msg.sender, token);
  }

  function setRefer(address referral, address token) external  {
    Main storage $ = _getMainStorage();
    
    if (msg.sender == referral) {
      revert Staking__SelfReferringError();
    }
    if ($.referralToReferrer[referral] != address(0)) {
      revert Staking__ReferrerAlreadySetted($.referralToReferrer[referral]);
    } 
    if ($.stakes[msg.sender][token].balance == 0) {
      revert Staking__ZeroReferrerBalance();
    }
    $.referralToReferrer[referral] = msg.sender;
  }

  function setNewRewardRate(uint256 newRewardRate) onlyRole(DEFAULT_ADMIN_ROLE) external  {
    Main storage $ = _getMainStorage();
    $.rewardRate = newRewardRate;
  }

  function setNewClaimLockTime(uint256 newClaimLockTime) onlyRole(DEFAULT_ADMIN_ROLE) external  {
    Main storage $ = _getMainStorage();
    $.claimLockTime = newClaimLockTime;
  }
  
  function calculateCurrentReward(address user, address token) public view  returns (uint256 amountToClaim, uint256 fullCyclesPassed) {
    Main storage $ = _getMainStorage();
    uint256 since = $.stakes[user][token].lastClaimTimestamp;
    if (since == 0) {
      since = $.stakes[user][token].stakeTimestamp;
    }
    if (since == 0) {
        return (0, 0);
    }

    fullCyclesPassed = (block.timestamp - since) / $.claimLockTime;
    amountToClaim = ($.stakes[user][token].balance * $.rewardRate * fullCyclesPassed) / 1000;
  }

  function rewardRate() external view returns(uint256) {
    Main storage $ = _getMainStorage();
    return $.rewardRate;
  }

  function claimLockTime() external view returns(uint256) {
    Main storage $ = _getMainStorage();
    return $.claimLockTime;
  }

  function stakes(address user, address token) external view returns (StakeInfo memory) {
    Main storage $ = _getMainStorage();
    return $.stakes[user][token];
  }
  
  function referralToReferrer(address referral) external view returns (address) {
    Main storage $ = _getMainStorage();

    return $.referralToReferrer[referral];
  }

  function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlUpgradeable, IERC165) returns (bool) {
    return interfaceId == type(IStaking).interfaceId || super.supportsInterface(interfaceId);
  }
  
  function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
  
  function _getMainStorage() private pure returns(Main storage $) {
    assembly {
      $.slot := MAIN_STORAGE_LOCATION
    }
  }
}