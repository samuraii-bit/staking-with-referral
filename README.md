# Staking Contract

A decentralized staking protocol deployed on BSC Testnet with referral system and upgradeable architecture.

## About

This project implements a sophisticated system that allows users to stake ERC20 tokens and earn rewards with referral bonuses.

### Key Features
- **Token Staking**: Deposit ERC20 tokens to earn rewards
- **Referral System**: 0.5% bonus for referrals
- **Upgradeable**: UUPS upgradeable contract pattern
- **Secure**: Reentrancy protection and access control
- **Flexible Rewards**: Admin-configurable reward rates

## Technical Details

### Network Configuration

**BSC Testnet**
- Chain ID: 97
- Symbol: BNB
- Explorer: https://testnet.bscscan.com

### Deployed Contracts

| Contract | Address | Type |
|----------|---------|------|
| **Staking Contract** | `0x4d75aCfD0c8BC61718E06137bB0484A1ce28384E` | Proxy |
| **TestToken** | `0x90aC86814480e678CC53e1F59A8dAC5Aecf5dA9E` | ERC20 |

### Prerequisites

- Node.js 16+
- npm or yarn
- MetaMask with BSC Testnet configured
- Test BNB for gas fees