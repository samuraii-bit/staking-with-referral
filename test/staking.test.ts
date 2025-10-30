import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";
import { Staking, TestToken } from "../typechain-types";

describe("Staking", function () {
  let staking: Staking;
  let testToken: TestToken;
  let admin: Signer;
  let user1: Signer;
  let user2: Signer;
  let user3: Signer;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const STAKE_AMOUNT = ethers.parseEther("1000");
  const DAY = 24 * 60 * 60;

  beforeEach(async function () {
    [admin, user1, user2, user3] = await ethers.getSigners();

    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    testToken = await TestTokenFactory.deploy(INITIAL_SUPPLY);
    await testToken.waitForDeployment();

    const StakingFactory = await ethers.getContractFactory("Staking");
    staking = await upgrades.deployProxy(StakingFactory, [await admin.getAddress()], {
      initializer: "initialize",
    }) as unknown as Staking;
    await staking.waitForDeployment();

    await testToken.transfer(await user1.getAddress(), ethers.parseEther("10000"));
    await testToken.transfer(await user2.getAddress(), ethers.parseEther("10000"));
    await testToken.transfer(await user3.getAddress(), ethers.parseEther("10000"));

    await testToken.transfer(await staking.getAddress(), ethers.parseEther("50000"));
  });

  describe("Initialization", function () {
    it("Should initialize with correct values", async function () {
      expect(await staking.rewardRate()).to.equal(10);
      expect(await staking.claimLockTime()).to.equal(DAY);
      expect(await staking.hasRole(await staking.DEFAULT_ADMIN_ROLE(), await admin.getAddress())).to.be.true;
      expect(await staking.hasRole(await staking.UPGRADER_ROLE(), await admin.getAddress())).to.be.true;
    });
  });

  describe("Deposit", function () {
    it("Should allow deposit", async function () {
      const user1Address = await user1.getAddress();
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);

      const stakeInfo = await staking.stakes(user1Address, await testToken.getAddress());
      expect(stakeInfo.balance).to.equal(STAKE_AMOUNT);
      expect(stakeInfo.stakeTimestamp).to.be.gt(0);
      expect(stakeInfo.lastClaimTimestamp).to.be.gt(0);
    });

    it("Should revert with zero amount", async function () {
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await expect(
        staking.connect(user1).deposit(await testToken.getAddress(), 0)
      ).to.be.revertedWithCustomError(staking, "Staking__ZeroValue");
    });

    it("Should claim existing rewards on subsequent deposit", async function () {
      const user1Address = await user1.getAddress();
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT * 2n);

      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      const balanceAfterFirstDeposit = await testToken.balanceOf(user1Address);

      await ethers.provider.send("evm_increaseTime", [2 * DAY]);
      await ethers.provider.send("evm_mine", []);

      const expectedReward = STAKE_AMOUNT * 10n * 2n / 1000n; 

      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);

      const finalBalance = await testToken.balanceOf(user1Address);
      
      const expectedBalance = balanceAfterFirstDeposit + expectedReward - STAKE_AMOUNT;
      expect(finalBalance).to.equal(expectedBalance);

      const stakeInfo = await staking.stakes(user1Address, await testToken.getAddress());
      expect(stakeInfo.balance).to.equal(STAKE_AMOUNT * 2n);
    });
  });

  describe("Referral System", function () {
    it("Should set referrer", async function () {
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await staking.connect(user1).setRefer(user2Address, await testToken.getAddress());
      
      expect(await staking.referralToReferrer(user2Address)).to.equal(user1Address);
    });

    it("Should pay referral bonus on deposit", async function () {
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await staking.connect(user1).setRefer(user2Address, await testToken.getAddress());
      
      const initialBalance = await testToken.balanceOf(user1Address);
      const expectedBonus = STAKE_AMOUNT * 5n / 1000n;
      
      await testToken.connect(user2).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user2).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      const finalBalance = await testToken.balanceOf(user1Address);
      expect(finalBalance - initialBalance).to.equal(expectedBonus);
    });

    it("Should revert self referring", async function () {
      const user1Address = await user1.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await expect(
        staking.connect(user1).setRefer(user1Address, await testToken.getAddress())
      ).to.be.revertedWithCustomError(staking, "Staking__SelfReferringError");
    });

    it("Should revert with zero referrer balance", async function () {
      await expect(
        staking.connect(user1).setRefer(await user2.getAddress(), await testToken.getAddress())
      ).to.be.revertedWithCustomError(staking, "Staking__ZeroReferrerBalance");
    });

    it("Should revert when referrer already set", async function () {
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      const user3Address = await user3.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await staking.connect(user1).setRefer(user2Address, await testToken.getAddress());
      
      await testToken.connect(user3).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user3).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await expect(
        staking.connect(user3).setRefer(user2Address, await testToken.getAddress())
      ).to.be.revertedWithCustomError(staking, "Staking__ReferrerAlreadySetted")
        .withArgs(user1Address);
    });
  });

  describe("Claim", function () {
    it("Should claim rewards", async function () {
      const user1Address = await user1.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [2 * DAY]);
      await ethers.provider.send("evm_mine", []);
      
      const expectedReward = STAKE_AMOUNT * 10n * 2n / 1000n;
      const initialBalance = await testToken.balanceOf(user1Address);
      
      await staking.connect(user1).claim(await testToken.getAddress());
      
      const finalBalance = await testToken.balanceOf(user1Address);
      expect(finalBalance - initialBalance).to.equal(expectedReward);
    });

    it("Should revert early claim", async function () {
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [12 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      
      await expect(
        staking.connect(user1).claim(await testToken.getAddress())
      ).to.be.revertedWithCustomError(staking, "Staking__EarlyClaim");
    });

    it("Should revert when nothing to claim", async function () {
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await expect(
        staking.connect(user1).claim(await testToken.getAddress())
      ).to.be.revertedWithCustomError(staking, "Staking__EarlyClaim");
    });
  });

  describe("Unstake", function () {
    it("Should unstake with rewards", async function () {
      const user1Address = await user1.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [2 * DAY]);
      await ethers.provider.send("evm_mine", []);
      
      const expectedReward = STAKE_AMOUNT * 10n * 2n / 1000n;
      const initialBalance = await testToken.balanceOf(user1Address);
      
      await staking.connect(user1).unstake(await testToken.getAddress());
      
      const finalBalance = await testToken.balanceOf(user1Address);
      expect(finalBalance - initialBalance).to.equal(STAKE_AMOUNT + expectedReward);
      
      const stakeInfo = await staking.stakes(user1Address, await testToken.getAddress());
      expect(stakeInfo.balance).to.equal(0);
      expect(stakeInfo.stakeTimestamp).to.equal(0);
      expect(stakeInfo.lastClaimTimestamp).to.equal(0);
    });

    it("Should revert when nothing to unstake", async function () {
      await expect(
        staking.connect(user1).unstake(await testToken.getAddress())
      ).to.be.revertedWithCustomError(staking, "Staking__NothingToUnstake");
    });
  });

  describe("Reward Calculation", function () {
    it("Should calculate current reward correctly", async function () {
      const user1Address = await user1.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [3 * DAY]);
      await ethers.provider.send("evm_mine", []);
      
      const [amountToClaim, fullCyclesPassed] = await staking.calculateCurrentReward(
        user1Address, 
        await testToken.getAddress()
      );
      
      expect(fullCyclesPassed).to.equal(3);
      expect(amountToClaim).to.equal(STAKE_AMOUNT * 10n * 3n / 1000n);
    });

    it("Should return zero for no stake", async function () {
      const [amountToClaim, fullCyclesPassed] = await staking.calculateCurrentReward(
        await user1.getAddress(), 
        await testToken.getAddress()
      );
      
      expect(amountToClaim).to.equal(0);
      expect(fullCyclesPassed).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should set new reward rate", async function () {
      const newRate = 20;
      await staking.connect(admin).setNewRewardRate(newRate);
      expect(await staking.rewardRate()).to.equal(newRate);
    });

    it("Should revert setting reward rate by non-admin", async function () {
      await expect(
        staking.connect(user1).setNewRewardRate(20)
      ).to.be.reverted;
    });

    it("Should set new claim lock time", async function () {
      const newLockTime = 2 * DAY;
      await staking.connect(admin).setNewClaimLockTime(newLockTime);
      expect(await staking.claimLockTime()).to.equal(newLockTime);
    });

    it("Should revert setting claim lock time by non-admin", async function () {
      await expect(
        staking.connect(user1).setNewClaimLockTime(2 * DAY)
      ).to.be.reverted;
    });
  });

  describe("Upgrade", function () {
    it("Should upgrade contract", async function () {
      const StakingFactory = await ethers.getContractFactory("Staking");
      const stakingV2 = await upgrades.upgradeProxy(await staking.getAddress(), StakingFactory);
      await stakingV2.waitForDeployment();
      
      expect(await stakingV2.rewardRate()).to.equal(10);
    });

    it("Should revert upgrade by non-upgrader", async function () {
      const StakingFactory = await ethers.getContractFactory("Staking");
      
      await expect(
        upgrades.upgradeProxy(await staking.getAddress(), StakingFactory.connect(user1))
      ).to.be.reverted;
    });
  });

  describe("Multiple Users", function () {
    it("Should handle multiple users staking", async function () {
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await testToken.connect(user2).approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.connect(user2).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [2 * DAY]);
      await ethers.provider.send("evm_mine", []);
      
      await staking.connect(user1).claim(await testToken.getAddress());
      await staking.connect(user2).claim(await testToken.getAddress());
      
      const stakeInfo1 = await staking.stakes(user1Address, await testToken.getAddress());
      const stakeInfo2 = await staking.stakes(user2Address, await testToken.getAddress());
      
      expect(stakeInfo1.balance).to.equal(STAKE_AMOUNT);
      expect(stakeInfo2.balance).to.equal(STAKE_AMOUNT);
    });
  });

  describe("Complete Staking Cycle", function () {
    it("Should complete full staking cycle", async function () {
      const user1Address = await user1.getAddress();
      
      await testToken.connect(user1).approve(await staking.getAddress(), STAKE_AMOUNT * 2n);
      
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [DAY]);
      await ethers.provider.send("evm_mine", []);
      
      await staking.connect(user1).claim(await testToken.getAddress());
      
      await staking.connect(user1).deposit(await testToken.getAddress(), STAKE_AMOUNT);
      
      await ethers.provider.send("evm_increaseTime", [DAY]);
      await ethers.provider.send("evm_mine", []);
      
      const initialBalance = await testToken.balanceOf(user1Address);
      await staking.connect(user1).unstake(await testToken.getAddress());
      const finalBalance = await testToken.balanceOf(user1Address);
      
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });
});