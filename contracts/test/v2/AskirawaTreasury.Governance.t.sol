// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice G-GOV 01-07: constructor + governance proposal validation, epoch creation, MIN_QUORUM.
contract AskirawaTreasuryGovernanceTest is AskirawaTreasuryTestBase {
    // ------------------------------------------------------------ helpers
    /// @dev Address the NEXT treasury will get: the recovery contract is created first, so it is the second CREATE.
    function _predicted() internal view returns (address) {
        return vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
    }

    function _ctorReverts(bytes memory err, AskirawaTreasury.GovernancePayload memory c) internal {
        address r = address(_newRecovery()); // created first: a pending expectRevert applies to the next call
        vm.expectRevert(err);
        new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, r);
    }

    function _govReverts(bytes memory err, AskirawaTreasury.GovernancePayload memory c) internal {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(err);
        t.proposeGovernance(c, exp, MEMO);
    }

    function _e(bytes4 sel, uint256 a) internal pure returns (bytes memory) { return abi.encodeWithSelector(sel, a); }

    // ------------------------------------------------------------ G-GOV-01
    function test_GOV01_ConstructorStoresEpochOne() public view {
        assertEq(t.currentEpoch(), 1);
        AskirawaTreasury.Epoch memory e = t.getEpoch(1);
        assertEq(e.quorum, 2);
        assertEq(e.payrollDelay, PAYROLL_DELAY);
        assertEq(e.configDelay, CONFIG_DELAY);
        assertEq(e.guardian, guardian);
        assertEq(e.approvers.length, 3);
        assertEq(e.approvers[0], approver1);
        assertEq(e.approvers[2], approver3);
        assertEq(e.proposers.length, 2);
        assertEq(e.proposers[1], proposerOnly);
        assertEq(e.createdAt, 1); // deployed before setUp warp (default timestamp 1)
        assertEq(address(t.usdc()), address(usdc));
        assertEq(t.MIN_CONFIG_DELAY(), MIN_CONFIG_DELAY);
        assertEq(t.nextProposalId(), 1);
        assertFalse(t.paused());
        assertEq(t.getEpoch(2).approvers.length, 0, "no epoch 2 yet");
    }

    function test_GOV01_ConstructorRoleBitsAndNoDeployerAuthority() public view {
        assertTrue(t.isApprover(approver1) && t.isApprover(approver2) && t.isApprover(approver3));
        assertTrue(t.isProposer(approver1) && t.isProposer(proposerOnly));
        assertTrue(t.isProposer(approver2), "approver implicitly may propose");
        assertFalse(t.isApprover(proposerOnly));
        assertFalse(t.isApprover(address(this)), "deployer has no authority");
        assertFalse(t.isProposer(address(this)));
        assertEq(t.roleFlags(1, approver1), 3, "approver1 is both");
        assertEq(t.roleFlags(1, proposerOnly), 2);
        assertEq(t.roleFlags(1, approver2), 1);
    }

    function test_GOV01_ConstructorEmitsEpochCreated() public {
        address predicted = _predicted();
        vm.expectEmit(true, false, false, true, predicted);
        emit AskirawaTreasury.EpochCreated(1, 2, PAYROLL_DELAY, CONFIG_DELAY, guardian);
        AskirawaTreasury n = _deploy(_cfg(), MIN_CONFIG_DELAY);
        assertEq(address(n), predicted);
    }

    function test_GOV01_ConstructorAcceptsBoundaries() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _arr(approver1, approver2);
        c.proposers = new address[](0);
        c.guardian = address(0);
        c.payrollDelay = 0;
        c.configDelay = MIN_CONFIG_DELAY;
        AskirawaTreasury a = _deploy(c, MIN_CONFIG_DELAY);
        assertEq(a.quorum(), 2);
        assertEq(a.guardian(), address(0));

        c.approvers = _accts(20, 0);
        c.quorum = 20;
        c.proposers = _accts(50, 100);
        c.payrollDelay = 14 days;
        c.configDelay = 14 days;
        c.guardian = approver1; // guardian may overlap other roles
        AskirawaTreasury b = _deploy(c, MIN_CONFIG_DELAY);
        assertEq(b.approverCount(), 20);
        assertEq(b.proposers().length, 50);
        assertEq(b.payrollDelay(), 14 days);
    }

    // ------------------------------------------------------------ G-GOV-02 (constructor rejections)
    function test_GOV02_CtorRejectsZeroApprover() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _arr(approver1, address(0), approver3);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)), c);
    }

    function test_GOV02_CtorRejectsDuplicateApprovers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _arr(approver1, approver2, approver1);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.DuplicateRole.selector, approver1), c);
    }

    function test_GOV02_CtorRejectsFewerThanTwoApprovers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = new address[](1);
        c.approvers[0] = approver1;
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 1, 2), c);
        c.approvers = new address[](0);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 0, 2), c);
    }

    function test_GOV02_CtorRejectsBadQuorum() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        for (uint8 q = 0; q < 2; ++q) { // quorum 0 and quorum 1
            c.quorum = q;
            _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, q, 3), c);
        }
        c.quorum = 4; // above count
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 4, 3), c);
        c.quorum = 255;
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 255, 3), c);
    }

    function test_GOV02_CtorRejectsMoreThanTwentyApprovers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _accts(21, 0);
        c.quorum = 2;
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 21, 2), c);
    }

    function test_GOV02_CtorRejectsProposerProblems() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.proposers = _arr(proposerOnly, address(0));
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)), c);
        c.proposers = _arr(proposerOnly, proposerOnly);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.DuplicateRole.selector, proposerOnly), c);
        c.proposers = _accts(51, 100);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 3, 51), c);
    }

    /// @dev A reverted CREATE still bumps the deployer nonce, so the predicted address is recomputed each time.
    function test_GOV02_CtorRejectsTreasuryAsGuardianOrRole() public {
        address self = _predicted();
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.guardian = self;
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, self), c);

        self = _predicted();
        c = _cfg();
        c.approvers = _arr(approver1, approver2, self);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, self), c);

        self = _predicted();
        c = _cfg();
        c.proposers = _arr(approver1, self);
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, self), c);
    }

    function test_GOV02_CtorRejectsBadDelays() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.configDelay = MIN_CONFIG_DELAY - 1; // below floor
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, PAYROLL_DELAY, MIN_CONFIG_DELAY - 1), c);
        c = _cfg();
        c.payrollDelay = 14 days + 1;
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, 14 days + 1, CONFIG_DELAY), c);
        c = _cfg();
        c.configDelay = 14 days + 1;
        _ctorReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, PAYROLL_DELAY, 14 days + 1), c);
    }

    function test_GOV02_CtorRejectsUsdcWithoutCode() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        address eoa = makeAddr("noCodeToken");
        address r1 = address(_newRecovery());
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, eoa));
        new AskirawaTreasury(eoa, MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian, c.payrollDelay, c.configDelay, r1);
        address r2 = address(_newRecovery());
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, address(0)));
        new AskirawaTreasury(address(0), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian, c.payrollDelay, c.configDelay, r2);
    }

    // ------------------------------------------------------------ G-GOV-03 (proposal duplicates)
    function test_GOV03_ProposalRejectsDuplicateApprovers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _arr(approver2, approver3, approver2);
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.DuplicateRole.selector, approver2), c);
    }

    function test_GOV03_ProposalRejectsDuplicateOrZeroProposers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.proposers = _arr(proposerOnly, proposerOnly);
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.DuplicateRole.selector, proposerOnly), c);
        c.proposers = _arr(address(0), proposerOnly);
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)), c);
    }

    function test_GOV03_ProposalRejectsZeroApproverAndSelf() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _arr(approver1, address(0));
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)), c);
        c = _cfg();
        c.guardian = address(t);
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)), c);
        c = _cfg();
        c.proposers = _arr(approver1, address(t));
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)), c);
    }

    // ------------------------------------------------------------ G-GOV-04
    function test_GOV04_ProposalRejectsQuorumBelowTwo() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.quorum = 0;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 0, 3), c);
        c.quorum = 1;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 1, 3), c);
    }

    function test_GOV04_ProposalRejectsFewerThanTwoApprovers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = new address[](1);
        c.approvers[0] = approver1;
        c.quorum = 2;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 1, 2), c);
        c.quorum = 1;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 1, 2), c);
    }

    function test_GOV04_ProposalRejectsQuorumAboveCountAndTooManyApprovers() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.quorum = 4;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 4, 3), c);
        c.approvers = _accts(21, 0);
        c.quorum = 2;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 21, 2), c);
    }

    function test_GOV04_ProposalRejectsBadDelays() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.configDelay = MIN_CONFIG_DELAY - 1;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, PAYROLL_DELAY, MIN_CONFIG_DELAY - 1), c);
        c = _cfg();
        c.payrollDelay = 14 days + 1;
        _govReverts(abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, 14 days + 1, CONFIG_DELAY), c);
    }

    function test_GOV04_ValidProposalStoresPayloadAndEmitsItem() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.quorum = 3;
        uint64 exp = _exp();
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.GovernanceItem(1, c.approvers, c.proposers, 3, guardian, PAYROLL_DELAY, CONFIG_DELAY);
        vm.prank(approver1);
        uint256 id = t.proposeGovernance(c, exp, MEMO);
        assertEq(id, 1);
        assertEq(keccak256(t.getPayload(id)), t.getProposal(id).payloadHash);
        assertEq(t.getProposal(id).totalAmount, 0);
    }

    // ------------------------------------------------------------ G-GOV-05 (validation re-runs at execution)
    /// @dev Implementation-coupled by design: the only way to hand execute() an invalid payload is to corrupt
    /// the stored bytes. _payload is mapping slot 7 (forge inspect storage-layout). Word 3 of the encoded
    /// GovernancePayload is quorum, 4 guardian, 5 payrollDelay, 6 configDelay.
    function _corrupt(uint256 id, uint256 word, bytes32 value) internal {
        bytes32 lenSlot = keccak256(abi.encode(id, uint256(7)));
        uint256 len = uint256(vm.load(address(t), lenSlot));
        assertEq(len & 1, 1, "long bytes");
        bytes32 slot = bytes32(uint256(keccak256(abi.encode(lenSlot))) + word);
        vm.store(address(t), slot, value);
    }

    function _readyGov() internal returns (uint256 id) {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        id = _proposeGov(approver1, c);
        _reachQuorum(id);
        _warpToExecutable(id);
        bytes32 lenSlot = keccak256(abi.encode(id, uint256(7)));
        assertEq(uint256(vm.load(address(t), bytes32(uint256(keccak256(abi.encode(lenSlot))) + 3))), 2, "quorum word");
    }

    function test_GOV05_ExecutionRevalidatesQuorum() public {
        uint256 id = _readyGov();
        _corrupt(id, 3, bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 1, 3));
        t.execute(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable), "still pending/executable");
        assertEq(t.currentEpoch(), 1);
        _corrupt(id, 3, bytes32(uint256(9)));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 9, 3));
        t.execute(id);
    }

    function test_GOV05_ExecutionRevalidatesDelaysAndGuardian() public {
        uint256 id = _readyGov();
        _corrupt(id, 6, bytes32(uint256(15 days)));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, PAYROLL_DELAY, 15 days));
        t.execute(id);
        _corrupt(id, 6, bytes32(uint256(CONFIG_DELAY)));
        _corrupt(id, 4, bytes32(uint256(uint160(address(t)))));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)));
        t.execute(id);
        assertEq(t.currentEpoch(), 1, "no epoch created by failed executions");
    }

    // ------------------------------------------------------------ G-GOV-06
    function test_GOV06_ExecutionCreatesNewEpochNeverEditsOld() public {
        AskirawaTreasury.Epoch memory before_ = t.getEpoch(1);
        bytes32 h1 = keccak256(abi.encode(before_));
        address newApprover = makeAddr("newApprover");
        address newGuardian = makeAddr("newGuardian");
        AskirawaTreasury.GovernancePayload memory c;
        c.approvers = _arr(approver1, approver2, newApprover);
        c.proposers = _arr(outsider, payee1);
        c.quorum = 3;
        c.guardian = newGuardian;
        c.payrollDelay = 3 days;
        c.configDelay = 4 days;

        uint256 id = _proposeGov(approver1, c);
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.EpochCreated(2, 3, 3 days, 4 days, newGuardian);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(id, AskirawaTreasury.Action.Governance, 0);
        _exec(id);

        assertEq(t.currentEpoch(), 2);
        AskirawaTreasury.Epoch memory e2 = t.getEpoch(2);
        assertEq(e2.quorum, 3);
        assertEq(e2.guardian, newGuardian);
        assertEq(e2.payrollDelay, 3 days);
        assertEq(e2.configDelay, 4 days);
        assertEq(e2.approvers[2], newApprover);
        assertEq(e2.proposers[0], outsider);
        assertEq(e2.createdAt, _now());
        assertEq(keccak256(abi.encode(t.getEpoch(1))), h1, "epoch 1 byte-identical");
        assertTrue(t.isApproverAt(1, approver3) && !t.isApproverAt(2, approver3));
        assertTrue(t.isApprover(newApprover) && !t.isApprover(approver3));
        assertEq(t.guardian(), newGuardian);
        assertEq(t.quorum(), 3);
        assertEq(t.payrollDelay(), 3 days);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    // ------------------------------------------------------------ G-GOV-07
    function test_GOV07_MinQuorumIsTwoAndHasNoSetter() public {
        assertEq(t.MIN_QUORUM(), 2);
        string[10] memory sigs = [
            "setQuorum(uint8)", "setMinQuorum(uint8)", "setMIN_QUORUM(uint8)", "updateQuorum(uint8)",
            "lowerQuorum(uint8)", "changeQuorum(uint8)", "setApprovers(address[])", "addApprover(address)",
            "removeApprover(address)", "setGuardian(address)"];
        address[3] memory callers = [approver1, guardian, outsider];
        for (uint256 i; i < sigs.length; ++i) {
            for (uint256 j; j < callers.length; ++j) {
                vm.prank(callers[j]);
                (bool ok, bytes memory ret) = address(t).call(abi.encodePacked(bytes4(keccak256(bytes(sigs[i]))), new bytes(96)));
                assertFalse(ok, sigs[i]);
                assertEq(ret.length, 0, sigs[i]);
            }
        }
        assertEq(t.quorum(), 2);
    }

    function _govCfgFor(uint256 count, uint8 q) internal view returns (AskirawaTreasury.GovernancePayload memory c) {
        c = _cfg();
        c.approvers = _accts(count, 0);
        c.quorum = q;
    }

    function _validPair(uint256 count, uint8 q) internal pure returns (bool) {
        return count >= 2 && count <= 20 && q >= 2 && q <= count;
    }

    function testFuzz_GOV07_ProposalQuorumApproverCountPairs(uint8 q, uint8 countRaw) public {
        uint256 count = bound(countRaw, 0, 30);
        AskirawaTreasury.GovernancePayload memory c = _govCfgFor(count, q);
        uint64 exp = _exp();
        bool ok;
        vm.prank(approver1);
        try t.proposeGovernance(c, exp, MEMO) returns (uint256) { ok = true; } catch { ok = false; }
        assertEq(ok, _validPair(count, q), "accepted iff 2<=q<=count<=20");
        if (ok) {
            _pass(t.nextProposalId() - 1);
            assertGe(t.quorum(), t.MIN_QUORUM());
            assertLe(t.quorum(), t.approverCount());
            assertEq(t.approverCount(), count);
        }
    }

    function testFuzz_GOV07_ConstructorQuorumApproverCountPairs(uint8 q, uint8 countRaw) public {
        uint256 count = bound(countRaw, 0, 30);
        AskirawaTreasury.GovernancePayload memory c = _govCfgFor(count, q);
        bool ok;
        try new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, address(_newRecovery())) returns (AskirawaTreasury n) {
            ok = true;
            assertGe(n.quorum(), 2);
        } catch { ok = false; }
        assertEq(ok, _validPair(count, q));
    }
}
