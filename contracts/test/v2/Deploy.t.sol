// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DeployTestBase, ValidatorHarness} from "./Deploy.Base.t.sol";
import {DeployConfigValidator as V} from "../../script/DeployConfigValidator.sol";

/// @notice DEP group, part 1: DeployConfigValidator policy (pure, order-independent, parallel-safe).
contract DeployValidatorTest is DeployTestBase {
    ValidatorHarness internal h;

    function setUp() public { h = new ValidatorHarness(); }

    function _reject(V.Config memory c, bytes memory err) internal {
        vm.expectRevert(err);
        h.validate(c, _noForbidden());
    }

    function _fill(uint8 b) internal pure returns (address) {
        uint160 v;
        for (uint256 i; i < 20; ++i) v = (v << 8) | b;
        return address(v);
    }

    // ------------------------------------------------------------ acceptance
    function test_Accepts_MakeAddrRolesAndReportsSummary() public view {
        V.Summary memory s = h.validate(_valid(), _noForbidden());
        assertEq(s.approverCount, 3);
        assertEq(s.proposerCount, 2);
        assertTrue(s.guardianEnabled);
        assertFalse(s.guardianIsApprover);
    }

    function test_Accepts_GuardianExplicitlyDisabledAndNoProposers() public view {
        V.Config memory c = _valid();
        c.guardian = address(0);
        c.guardianDisabledAck = true;
        c.proposers = new address[](0);
        V.Summary memory s = h.validate(c, _noForbidden());
        assertFalse(s.guardianEnabled);
        c.guardianDisabledAck = false;
        c.guardian = guard;
        c.proposers = _list(ap1, ap2); // proposers may overlap approvers
        s = h.validate(c, _noForbidden());
        assertFalse(s.guardianIsApprover);
    }

    // ------------------------------------------------------------ guardian policy
    function test_Rejects_GuardianUnsetWithoutExplicitAcknowledgement() public {
        V.Config memory c = _valid();
        c.guardian = address(0);
        _reject(c, abi.encodeWithSelector(V.GuardianNotConfigured.selector));
    }

    function test_Rejects_GuardianSetTogetherWithDisabledAcknowledgement() public {
        V.Config memory c = _valid();
        c.guardianDisabledAck = true;
        _reject(c, abi.encodeWithSelector(V.GuardianConflict.selector, guard));
    }

    function test_Rejects_GuardianThatIsAlsoAnApprover() public {
        V.Config memory c = _valid();
        c.guardian = ap2;
        _reject(c, abi.encodeWithSelector(V.GuardianIsApprover.selector, ap2));
    }

    function test_SharedPlatformWalletConstantIsTheDocumentedAddress() public pure {
        assertEq(V.ARC_STUDIO_SHARED_PLATFORM_WALLET, SHARED);
    }

    // ------------------------------------------------------------ usdc
    function test_Rejects_ZeroUsdc() public {
        V.Config memory c = _valid();
        c.usdc = address(0);
        _reject(c, abi.encodeWithSelector(V.ZeroUsdc.selector));
    }

    function test_Rejects_ValidationOrderTokenBeforeEverythingElse() public {
        V.Config memory c = _valid();
        c.usdc = address(0);
        c.approvers = new address[](1);
        _reject(c, abi.encodeWithSelector(V.ZeroUsdc.selector));
    }

    // ------------------------------------------------------------ counts
    function test_Rejects_FewerThanTwoApprovers() public {
        V.Config memory c = _valid();
        c.approvers = new address[](0);
        _reject(c, abi.encodeWithSelector(V.InvalidApproverCount.selector, 0));
        c.approvers = new address[](1);
        c.approvers[0] = ap1;
        _reject(c, abi.encodeWithSelector(V.InvalidApproverCount.selector, 1));
        c.approvers = _list(ap1, ap2); // policy minimum is three distinct approvers
        _reject(c, abi.encodeWithSelector(V.InvalidApproverCount.selector, 2));
    }

    function test_Approver_Count_TwentyAcceptedTwentyOneRejected() public {
        V.Config memory c = _valid();
        c.approvers = _accts(20, 1);
        c.quorum = 19;
        h.validate(c, _noForbidden());
        c.approvers = _accts(21, 1);
        c.quorum = 2;
        _reject(c, abi.encodeWithSelector(V.InvalidApproverCount.selector, 21));
    }

    function test_Proposer_Count_FiftyAcceptedFiftyOneRejected() public {
        V.Config memory c = _valid();
        c.proposers = _accts(50, 2);
        h.validate(c, _noForbidden());
        c.proposers = _accts(51, 2);
        _reject(c, abi.encodeWithSelector(V.InvalidProposerCount.selector, 51));
    }

    // ------------------------------------------------------------ zero / duplicates / forbidden
    function test_Rejects_ZeroAddressInEveryListPosition() public {
        V.Config memory c = _valid();
        c.approvers[1] = address(0);
        _reject(c, abi.encodeWithSelector(V.ZeroRoleAddress.selector, V.Role.Approver, 1));
        c = _valid();
        c.proposers[1] = address(0);
        _reject(c, abi.encodeWithSelector(V.ZeroRoleAddress.selector, V.Role.Proposer, 1));
        c = _valid();
        c.approvers[0] = address(0);
        _reject(c, abi.encodeWithSelector(V.ZeroRoleAddress.selector, V.Role.Approver, 0));
    }

    function test_Rejects_DuplicatesWithinApproversAndWithinProposers() public {
        V.Config memory c = _valid();
        c.approvers = _list(ap1, ap2, ap1);
        _reject(c, abi.encodeWithSelector(V.DuplicateRoleAddress.selector, V.Role.Approver, 2, 0, ap1));
        c = _valid();
        c.proposers = _list(pr1, pr1);
        _reject(c, abi.encodeWithSelector(V.DuplicateRoleAddress.selector, V.Role.Proposer, 1, 0, pr1));
    }

    function test_Rejects_RoleEqualToAForbiddenContractAddress() public {
        V.Config memory c = _valid();
        address[] memory forbidden = new address[](2);
        forbidden[0] = makeAddr("someOtherContract");
        forbidden[1] = c.usdc;
        c.approvers[2] = c.usdc;
        vm.expectRevert(abi.encodeWithSelector(V.ForbiddenRoleAddress.selector, V.Role.Approver, 2, c.usdc, 1));
        h.validate(c, forbidden);
        c = _valid();
        c.guardian = forbidden[0];
        vm.expectRevert(abi.encodeWithSelector(V.ForbiddenRoleAddress.selector, V.Role.Guardian, 0, forbidden[0], 0));
        h.validate(c, forbidden);
    }

    // ------------------------------------------------------------ placeholders
    function _placeholders() internal pure returns (address[9] memory p) {
        uint160 allOnes = type(uint160).max;
        p = [address(uint160(1)), address(uint160(2)), address(uint160(0xdead)), address(uint160(57005)),
            address(uint160(type(uint32).max)), address(allOnes), _fill(0x11), _fill(0xaa), _fill(0x01)];
    }

    function test_Rejects_PlaceholderAddressesInEveryRole() public {
        address[9] memory bad = _placeholders();
        for (uint256 i; i < bad.length; ++i) {
            assertTrue(h.isPlaceholder(bad[i]));
            V.Config memory c = _valid();
            c.approvers[1] = bad[i];
            _reject(c, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Approver, 1, bad[i]));
            c = _valid();
            c.proposers[1] = bad[i];
            _reject(c, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Proposer, 1, bad[i]));
            c = _valid();
            c.guardian = bad[i];
            _reject(c, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Guardian, 0, bad[i]));
        }
    }

    function test_Rejects_IdenticalByteAddressesForEveryByteValue() public view {
        for (uint256 b; b < 256; ++b) assertTrue(h.isPlaceholder(_fill(uint8(b))), "identical bytes");
    }

    function test_Placeholder_SmallValueBoundaryIsExactlyTwoPow32() public view {
        assertTrue(h.isPlaceholder(address(uint160(uint256(1 << 32) - 1))));
        assertFalse(h.isPlaceholder(address(uint160(uint256(1) << 32))), "2**32 is the first non-small value");
        assertFalse(h.isPlaceholder(address(uint160(uint256(1) << 32) + 1)));
    }

    function test_Placeholder_SmallValuesBelowTwoPow32AreAllRejected() public view {
        // the predicate is documented as value < 2**32
        assertTrue(h.isPlaceholder(address(uint160(57004))), "57004 < 2**32 is small");
        assertTrue(h.isPlaceholder(address(uint160(57006))), "57006 < 2**32 is small");
    }

    function test_MakeAddrAndHashDerivedAddressesAreNeverPlaceholders() public {
        for (uint256 i; i < 64; ++i) {
            assertFalse(h.isPlaceholder(makeAddr(string.concat("label", vm.toString(i)))));
            assertFalse(h.isPlaceholder(vm.addr(1 + i)));
        }
    }

    function testFuzz_AnySmallAddressIsAPlaceholderAndRejectedAsARole(uint32 small) public {
        V.Config memory c = _valid();
        c.approvers[0] = address(uint160(small));
        if (small == 0) _reject(c, abi.encodeWithSelector(V.ZeroRoleAddress.selector, V.Role.Approver, 0));
        else _reject(c, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Approver, 0, address(uint160(small))));
    }

    function testFuzz_ArbitraryDerivedKeyAddressesAreAcceptedAsRoles(uint256 k1, uint256 k2, uint256 k3, uint256 k4) public view {
        uint256 n = 115792089237316195423570985008687907852837564279074904382605163141518161494336;
        address a = vm.addr(bound(k1, 1, n));
        address b = vm.addr(bound(k2, 1, n));
        address c_ = vm.addr(bound(k3, 1, n));
        address g = vm.addr(bound(k4, 1, n));
        if (a == b || a == c_ || b == c_ || a == usdcAddr || b == usdcAddr || c_ == usdcAddr || g == usdcAddr) return;
        if (g == a || g == b || g == c_) return; // a guardian must be separate from every approver
        V.Config memory c = _valid();
        c.approvers = _list(a, b, c_);
        c.proposers = _list(a, b);
        c.guardian = g;
        V.Summary memory s = h.validate(c, _noForbidden());
        assertEq(s.approverCount, 3);
    }

    // ------------------------------------------------------------ shared platform wallet
    function test_Rejects_SharedPlatformWalletInEveryRole() public {
        V.Config memory c = _valid();
        c.approvers[0] = SHARED;
        _reject(c, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Approver, 0));
        c = _valid();
        c.approvers[2] = SHARED;
        _reject(c, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Approver, 2));
        c = _valid();
        c.proposers[1] = SHARED;
        _reject(c, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Proposer, 1));
        c = _valid();
        c.guardian = SHARED;
        _reject(c, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Guardian, 0));
    }

    // ------------------------------------------------------------ quorum
    function test_Quorum_ZeroOneAndAboveCountRejectedCountAccepted() public {
        V.Config memory c = _valid(); // 3 approvers
        c.quorum = 0;
        _reject(c, abi.encodeWithSelector(V.InvalidQuorum.selector, 0, 3));
        c.quorum = 1;
        _reject(c, abi.encodeWithSelector(V.InvalidQuorum.selector, 1, 3));
        c.quorum = 4;
        _reject(c, abi.encodeWithSelector(V.InvalidQuorum.selector, 4, 3));
        c.quorum = type(uint256).max;
        _reject(c, abi.encodeWithSelector(V.InvalidQuorum.selector, type(uint256).max, 3));
        c.quorum = 3; // equal to the approver count: one lost key would lock the treasury
        _reject(c, abi.encodeWithSelector(V.InvalidQuorum.selector, 3, 3));
        c.quorum = 2;
        h.validate(c, _noForbidden());
    }

    // ------------------------------------------------------------ delays
    function test_Delays_TooLongRejectedFourteenDaysAccepted() public {
        V.Config memory c = _valid();
        c.minConfigDelay = 14 days + 1;
        _reject(c, abi.encodeWithSelector(V.DelayTooLong.selector, V.DelayField.MinConfigDelay, 14 days + 1));
        c = _valid();
        c.payrollDelay = 14 days + 1;
        _reject(c, abi.encodeWithSelector(V.DelayTooLong.selector, V.DelayField.PayrollDelay, 14 days + 1));
        c = _valid();
        c.configDelay = 14 days + 1;
        _reject(c, abi.encodeWithSelector(V.DelayTooLong.selector, V.DelayField.ConfigDelay, 14 days + 1));
        c = _valid();
        c.minConfigDelay = 14 days;
        c.payrollDelay = 14 days;
        c.configDelay = 14 days;
        h.validate(c, _noForbidden());
    }

    function test_Delays_PolicyFloorsEnforced() public {
        V.Config memory c = _valid();
        c.minConfigDelay = 1 hours - 1;
        c.configDelay = 1 hours - 1;
        _reject(c, abi.encodeWithSelector(V.DelayTooShort.selector, V.DelayField.MinConfigDelay, 1 hours - 1, 1 hours));
        c.minConfigDelay = 0;
        c.configDelay = 0;
        _reject(c, abi.encodeWithSelector(V.DelayTooShort.selector, V.DelayField.MinConfigDelay, 0, 1 hours));
        c = _valid();
        c.payrollDelay = 5 minutes - 1;
        _reject(c, abi.encodeWithSelector(V.DelayTooShort.selector, V.DelayField.PayrollDelay, 5 minutes - 1, 5 minutes));
        c.payrollDelay = 0;
        _reject(c, abi.encodeWithSelector(V.DelayTooShort.selector, V.DelayField.PayrollDelay, 0, 5 minutes));
        c = _valid();
        c.minConfigDelay = 1 hours;
        c.configDelay = 1 hours;
        c.payrollDelay = 5 minutes;
        h.validate(c, _noForbidden());
    }

    function test_Delays_ConfigDelayBelowTheMinimumRejected() public {
        V.Config memory c = _valid();
        c.minConfigDelay = 3 days;
        c.configDelay = 3 days - 1;
        _reject(c, abi.encodeWithSelector(V.ConfigDelayBelowMinimum.selector, 3 days - 1, 3 days));
        c.configDelay = 3 days;
        h.validate(c, _noForbidden());
    }

    // ------------------------------------------------------------ retry / maxFailures
    function test_RetryDelay_BoundsOneHourToSevenDays() public {
        V.Config memory c = _valid();
        c.retryDelay = 1 hours - 1;
        _reject(c, abi.encodeWithSelector(V.InvalidRetryDelay.selector, 1 hours - 1));
        c.retryDelay = 0;
        _reject(c, abi.encodeWithSelector(V.InvalidRetryDelay.selector, 0));
        c.retryDelay = 7 days + 1;
        _reject(c, abi.encodeWithSelector(V.InvalidRetryDelay.selector, 7 days + 1));
        c.retryDelay = 1 hours;
        h.validate(c, _noForbidden());
        c.retryDelay = 7 days;
        h.validate(c, _noForbidden());
    }

    function test_MaxFailures_BoundsOneToTen() public {
        V.Config memory c = _valid();
        c.maxFailures = 0;
        _reject(c, abi.encodeWithSelector(V.InvalidMaxFailures.selector, 0));
        c.maxFailures = 11;
        _reject(c, abi.encodeWithSelector(V.InvalidMaxFailures.selector, 11));
        c.maxFailures = 256 + 3; // would wrap to 3 if narrowed before validation
        _reject(c, abi.encodeWithSelector(V.InvalidMaxFailures.selector, 259));
        c.maxFailures = 1;
        h.validate(c, _noForbidden());
        c.maxFailures = 10;
        h.validate(c, _noForbidden());
    }

    // ------------------------------------------------------------ budget
    function test_Budget_ZeroPerTxPerTxAboveWindowAndOverflowRejected() public {
        V.Config memory c = _valid();
        c.perTxMax = 0;
        _reject(c, abi.encodeWithSelector(V.ZeroPerTxMax.selector));
        c = _valid();
        c.perTxMax = c.windowMax + 1;
        _reject(c, abi.encodeWithSelector(V.PerTxMaxExceedsWindowMax.selector, c.windowMax + 1, c.windowMax));
        c = _valid();
        c.perTxMax = c.windowMax; // equal is allowed
        h.validate(c, _noForbidden());
        c.perTxMax = uint256(type(uint96).max) + 1;
        c.windowMax = uint256(type(uint96).max) + 1;
        _reject(c, abi.encodeWithSelector(V.BudgetAmountOverflow.selector, c.perTxMax, c.windowMax));
        c.perTxMax = 1;
        c.windowMax = uint256(type(uint96).max) + 1;
        _reject(c, abi.encodeWithSelector(V.BudgetAmountOverflow.selector, 1, c.windowMax));
        c.windowMax = type(uint96).max;
        h.validate(c, _noForbidden());
    }

    function test_Budget_WindowLengthOneDayToThreeSixtyFiveDays() public {
        V.Config memory c = _valid();
        c.windowLength = 1 days - 1;
        _reject(c, abi.encodeWithSelector(V.InvalidWindowLength.selector, 1 days - 1));
        c.windowLength = 0;
        _reject(c, abi.encodeWithSelector(V.InvalidWindowLength.selector, 0));
        c.windowLength = 365 days + 1;
        _reject(c, abi.encodeWithSelector(V.InvalidWindowLength.selector, 365 days + 1));
        c.windowLength = 1 days;
        h.validate(c, _noForbidden());
        c.windowLength = 365 days;
        h.validate(c, _noForbidden());
    }

    /// @dev OBSERVATION, not an endorsement: the validator only treats the literal value 0xdEaD as the dead sentinel.
    /// The other widely used burn address (0xdEaD followed by 36 zeros) is not a "small" value, not identical-byte, and
    /// is therefore ACCEPTED as a role. Reported to the main agent as a Low/Info gap; if the validator is hardened this
    /// test is expected to flip and should then assert rejection.
    function test_Observation_DeadPrefixBurnAddressIsNotTreatedAsAPlaceholder() public {
        address burn = address(uint160(0xdead) << 144);
        assertFalse(h.isPlaceholder(burn));
        V.Config memory c = _valid();
        c.approvers = _list(ap1, burn, ap3);
        h.validate(c, _noForbidden());
    }

    // ------------------------------------------------------------ recovery council policy
    function test_Council_ExactlyThreeMembersWithThresholdTwo() public {
        V.Config memory c = _valid();
        c.council = _list(cn1, cn2);
        _reject(c, abi.encodeWithSelector(V.InvalidCouncilCount.selector, 2));
        c.council = new address[](0);
        _reject(c, abi.encodeWithSelector(V.InvalidCouncilCount.selector, 0));
        c.council = _accts(4, 9);
        _reject(c, abi.encodeWithSelector(V.InvalidCouncilCount.selector, 4));
        c = _valid();
        c.councilThreshold = 1;
        _reject(c, abi.encodeWithSelector(V.InvalidCouncilThreshold.selector, 1));
        c.councilThreshold = 3;
        _reject(c, abi.encodeWithSelector(V.InvalidCouncilThreshold.selector, 3));
        c.councilThreshold = 0;
        _reject(c, abi.encodeWithSelector(V.InvalidCouncilThreshold.selector, 0));
    }

    function test_Council_MustBeIndependentOfApproversAndGuardian() public {
        V.Config memory c = _valid();
        c.council = _list(cn1, ap2, cn3);
        _reject(c, abi.encodeWithSelector(V.CouncilOverlapsApprover.selector, ap2));
        c = _valid();
        c.council = _list(cn1, cn2, guard);
        _reject(c, abi.encodeWithSelector(V.CouncilIsGuardian.selector, guard));
    }

    function test_Council_ZeroPlaceholderDuplicateSharedAndForbiddenAddressesRejected() public {
        V.Config memory c = _valid();
        c.council = _list(cn1, address(0), cn3);
        _reject(c, abi.encodeWithSelector(V.ZeroRoleAddress.selector, V.Role.Council, 1));
        c.council = _list(cn1, address(uint160(1)), cn3);
        _reject(c, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Council, 1, address(uint160(1))));
        c.council = _list(cn1, cn2, cn1);
        _reject(c, abi.encodeWithSelector(V.DuplicateRoleAddress.selector, V.Role.Council, 2, 0, cn1));
        c.council = _list(cn1, SHARED, cn3);
        _reject(c, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Council, 1));
        c.council = _list(cn1, cn2, usdcAddr);
        address[] memory forbidden = new address[](1);
        forbidden[0] = usdcAddr;
        vm.expectRevert(abi.encodeWithSelector(V.ForbiddenRoleAddress.selector, V.Role.Council, 2, usdcAddr, 0));
        h.validate(c, forbidden);
    }

    function test_Council_DisabledGuardianStillRequiresAnIndependentCouncil() public view {
        V.Config memory c = _valid();
        c.guardian = address(0);
        c.guardianDisabledAck = true;
        h.validate(c, _noForbidden());
    }
}
