// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ScheduleMath} from "../../v2/libraries/ScheduleMath.sol";
import {ScheduleMathHarness, ScheduleRef} from "./RecurringPaymentModule.MathRef.t.sol";

/// @notice M-MATH 01..08 for ScheduleMath, checked against the naive reference in MathRef.
contract RecurringPaymentModuleMathTest is Test, ScheduleRef {
    ScheduleMathHarness internal h;
    ScheduleMath.Frequency internal constant DAILY = ScheduleMath.Frequency.Daily;
    ScheduleMath.Frequency internal constant WEEKLY = ScheduleMath.Frequency.Weekly;
    ScheduleMath.Frequency internal constant MONTHLY = ScheduleMath.Frequency.Monthly;

    function setUp() public {
        h = new ScheduleMathHarness();
    }

    // ------------------------------------------------------------ helpers
    function _freq(uint8 raw) internal pure returns (ScheduleMath.Frequency) {
        return ScheduleMath.Frequency(raw % 3);
    }

    /// @dev Asserts add(start, MONTHLY, n) equals the expected civil date AND the stepping reference.
    function _vec(uint64 start, uint256 n, uint256 y, uint256 m, uint256 d, uint256 hh, uint256 mi, uint256 ss)
        internal view
    {
        uint64 got = h.add(start, MONTHLY, n);
        assertEq(got, refTs(y, m, d, hh, mi, ss), "civil date");
        assertEq(got, refMonthly(start, n), "reference walk");
    }

    // ------------------------------------------------------------ reference sanity (guards the oracle itself)
    function test_Math00_ReferenceMatchesKnownEpochConstants() public pure {
        assertEq(refToTs(1970, 1, 1, 0), 0);
        assertEq(refToTs(2000, 1, 1, 0), 946684800);
        assertEq(refToTs(2000, 2, 29, 0), 951782400);
        assertEq(refToTs(2027, 1, 1, 0), 1798761600);
        assertEq(refToTs(2038, 1, 19, 3 * 3600 + 14 * 60 + 7), 2147483647);
        assertEq(refToTs(9999, 12, 31, 86399), REF_MAX_TS);
        (uint256 y, uint256 m, uint256 d, uint256 s) = refCivil(REF_MAX_TS);
        assertEq(y * 10000 + m * 100 + d, 99991231);
        assertEq(s, 86399);
        (y, m, d, s) = refCivil(2147483647);
        assertEq(y * 10000 + m * 100 + d, 20380119);
        assertEq(s, 11647);
    }

    // ------------------------------------------------------------ M-MATH-01 daily / weekly exact
    function test_Math01_DailyExactAcrossMonthsAndLeapDay() public view {
        uint64 start = refTs(2027, 1, 31, 9, 0, 0);
        uint256 ts = start;
        for (uint256 n; n <= 800; ++n) {
            assertEq(h.add(start, DAILY, n), ts, "daily n");
            ts += 86400;
        }
        // 2028-02-28 09:00 -> +1 day is the leap day, +2 days is 1 March
        uint64 s2 = refTs(2028, 2, 28, 9, 0, 0);
        assertEq(h.add(s2, DAILY, 1), refTs(2028, 2, 29, 9, 0, 0));
        assertEq(h.add(s2, DAILY, 2), refTs(2028, 3, 1, 9, 0, 0));
        // same step across non-leap February
        uint64 s3 = refTs(2027, 2, 28, 9, 0, 0);
        assertEq(h.add(s3, DAILY, 1), refTs(2027, 3, 1, 9, 0, 0));
    }

    function test_Math01_WeeklyExactAndWeekdayStable() public view {
        uint64 start = refTs(2027, 12, 31, 23, 59, 59);
        uint256 ts = start;
        uint256 weekday = (uint256(start) / 86400 + 4) % 7; // 1970-01-01 was a Thursday
        for (uint256 n; n <= 400; ++n) {
            uint64 got = h.add(start, WEEKLY, n);
            assertEq(got, ts, "weekly n");
            assertEq((uint256(got) / 86400 + 4) % 7, weekday, "weekday drift");
            assertEq(got % 86400, 86399, "time of day");
            ts += 604800;
        }
    }

    function testFuzz_Math01_DailyWeeklyMatchPlainFormula(uint64 start, uint256 n, bool weekly) public view {
        start = uint64(bound(start, 0, REF_MAX_TS));
        ScheduleMath.Frequency f = weekly ? WEEKLY : DAILY;
        uint256 step = weekly ? 604800 : 86400;
        uint256 maxP = (REF_MAX_TS - start) / step;
        assertEq(h.maxPeriod(start, f), maxP, "maxPeriod");
        n = bound(n, 0, maxP);
        assertEq(h.add(start, f, n), uint256(start) + n * step);
    }

    // ------------------------------------------------------------ M-MATH-02 reference vectors (design 2.4)
    function test_Math02_Jan31Anchor_ClampRecoverNoAccumulation() public view {
        uint64 a = refTs(2027, 1, 31, 9, 0, 0);
        assertEq(a, 1801386000, "literal anchor"); // 1798761600 + 30 days + 9h
        _vec(a, 0, 2027, 1, 31, 9, 0, 0);
        _vec(a, 1, 2027, 2, 28, 9, 0, 0);
        _vec(a, 2, 2027, 3, 31, 9, 0, 0);
        _vec(a, 3, 2027, 4, 30, 9, 0, 0);
        _vec(a, 4, 2027, 5, 31, 9, 0, 0);
        _vec(a, 5, 2027, 6, 30, 9, 0, 0);
    }

    function test_Math02_Jan30Anchor_ClampsOnlyInFebruary() public view {
        uint64 a = refTs(2027, 1, 30, 9, 0, 0);
        _vec(a, 1, 2027, 2, 28, 9, 0, 0);
        _vec(a, 2, 2027, 3, 30, 9, 0, 0);
    }

    function test_Math02_Jan29Anchor_NonLeapFebruary() public view {
        _vec(refTs(2027, 1, 29, 9, 0, 0), 1, 2027, 2, 28, 9, 0, 0);
    }

    function test_Math02_LeapFebruary() public view {
        uint64 a = refTs(2028, 1, 31, 9, 0, 0);
        _vec(a, 1, 2028, 2, 29, 9, 0, 0);
        _vec(a, 2, 2028, 3, 31, 9, 0, 0);
    }

    function test_Math02_Feb29Anchor_FallsBackAndReturnsInLeapYear() public view {
        uint64 a = refTs(2028, 2, 29, 9, 0, 0);
        _vec(a, 12, 2029, 2, 28, 9, 0, 0);
        _vec(a, 24, 2030, 2, 28, 9, 0, 0);
        _vec(a, 48, 2032, 2, 29, 9, 0, 0);
        // the clamp never leaks into neighbouring months
        _vec(a, 1, 2028, 3, 29, 9, 0, 0);
        _vec(a, 11, 2029, 1, 29, 9, 0, 0);
        _vec(a, 13, 2029, 3, 29, 9, 0, 0);
    }

    function test_Math02_YearCarryAndLastSecondOfDay() public view {
        uint64 a = refTs(2027, 12, 31, 23, 59, 59);
        _vec(a, 0, 2027, 12, 31, 23, 59, 59);
        _vec(a, 1, 2028, 1, 31, 23, 59, 59);
        _vec(a, 2, 2028, 2, 29, 23, 59, 59);
    }

    function test_Math02_CenturyRules2100And2400() public view {
        _vec(refTs(2100, 1, 31, 0, 0, 0), 1, 2100, 2, 28, 0, 0, 0);
        _vec(refTs(2400, 1, 31, 0, 0, 0), 1, 2400, 2, 29, 0, 0, 0);
        // 2100-02-28 + 1 day must roll into March (no 29 Feb 2100), 2400 must not
        assertEq(h.add(refTs(2100, 2, 28, 0, 0, 0), DAILY, 1), refTs(2100, 3, 1, 0, 0, 0));
        assertEq(h.add(refTs(2400, 2, 28, 0, 0, 0), DAILY, 1), refTs(2400, 2, 29, 0, 0, 0));
    }

    function test_Math02_OrdinaryDay15Anchor() public view {
        uint64 a = refTs(2027, 3, 15, 12, 0, 0);
        _vec(a, 0, 2027, 3, 15, 12, 0, 0);
        _vec(a, 1, 2027, 4, 15, 12, 0, 0);
        _vec(a, 2, 2027, 5, 15, 12, 0, 0);
        _vec(a, 3, 2027, 6, 15, 12, 0, 0);
    }

    // ------------------------------------------------------------ M-MATH-03 no drift over 120 monthly periods
    /// @dev Decodes every library result independently and requires: month == anchor month + n,
    /// day == min(anchorDay, daysInMonth), time of day == anchor time of day.
    function _driftWalk(uint256 ay, uint256 am, uint256 ad, uint256 sod) internal view {
        uint64 start = uint64(refToTs(ay, am, ad, sod));
        uint256 base = ay * 12 + am - 1;
        for (uint256 n; n < 120; ++n) {
            (uint256 y, uint256 m, uint256 d, uint256 s) = refCivil(h.add(start, MONTHLY, n));
            uint256 idx = base + n;
            uint256 ey = idx / 12;
            uint256 em = idx % 12 + 1;
            uint256 dim = refDim(ey, em);
            assertEq(y * 100 + m, ey * 100 + em, "month index drift");
            assertEq(d, ad < dim ? ad : dim, "clamp accumulated or day drift");
            assertEq(s, sod, "time of day drift");
        }
    }

    /// @dev All anchor days valid for the start months [fromM, toM] of 2027, at 12:34:56 (split for the gas cap).
    function _noonMonths(uint256 fromM, uint256 toM) internal view {
        for (uint256 am = fromM; am <= toM; ++am) {
            for (uint256 ad = 1; ad <= refDim(2027, am); ++ad) _driftWalk(2027, am, ad, 45296);
        }
    }

    function test_Math03_NoDrift_EveryAnchorDay_StartMonths_1_2() public view { _noonMonths(1, 2); }

    function test_Math03_NoDrift_EveryAnchorDay_StartMonths_3_4() public view { _noonMonths(3, 4); }

    function test_Math03_NoDrift_EveryAnchorDay_StartMonths_5_6() public view { _noonMonths(5, 6); }

    function test_Math03_NoDrift_EveryAnchorDay_StartMonths_7_8() public view { _noonMonths(7, 8); }

    function test_Math03_NoDrift_EveryAnchorDay_StartMonths_9_10() public view { _noonMonths(9, 10); }

    function test_Math03_NoDrift_EveryAnchorDay_StartMonths_11_12() public view { _noonMonths(11, 12); }

    function test_Math03_NoDrift_EveryAnchorDay_MidnightAndLastSecond() public view {
        for (uint256 ad = 1; ad <= 31; ++ad) {
            _driftWalk(2027, 1, ad, 0);
            _driftWalk(2027, 1, ad, 86399);
        }
    }

    function test_Math03_NoDrift_EveryAnchorDay_NineAm_LeapStartYear() public view {
        for (uint256 ad = 1; ad <= 31; ++ad) {
            _driftWalk(2028, 1, ad, 32400);
            if (ad <= 29) _driftWalk(2028, 2, ad, 32400); // 29 Feb anchor included
        }
    }

    function test_Math03_NoDrift_CenturyCrossing2100And2400() public view {
        for (uint256 ad = 1; ad <= 31; ++ad) {
            _driftWalk(2099, 1, ad, 3600);
            _driftWalk(2399, 1, ad, 82800);
        }
    }

    // ------------------------------------------------------------ M-MATH-04 fuzz vs reference
    function testFuzz_Math04_MonthlyArbitraryTimestampMatchesRef(uint256 rawStart, uint256 rawN) public view {
        uint256 start = bound(rawStart, 0, REF_MAX_TS / 8); // up to year ~2400
        uint256 n = bound(rawN, 0, 1500);
        assertEq(h.add(uint64(start), MONTHLY, n), refMonthly(start, n));
    }

    function testFuzz_Math04_MonthlyCalendarAnchorMatchesRef(uint256 y, uint256 m, uint256 d, uint256 sod, uint256 n)
        public view
    {
        y = bound(y, 1970, 2500);
        m = bound(m, 1, 12);
        d = bound(d, 1, refDim(y, m));
        sod = bound(sod, 0, 86399);
        n = bound(n, 0, 1200);
        uint256 start = refToTs(y, m, d, sod);
        assertEq(h.add(uint64(start), MONTHLY, n), refMonthly(start, n));
    }

    function testFuzz_Math04_LateMonthAnchorsMatchRef(uint256 y, uint256 m, uint256 d, uint256 n) public view {
        y = bound(y, 1970, 2500);
        m = bound(m, 1, 12);
        d = bound(d, 28, 31);
        uint256 dim = refDim(y, m);
        if (d > dim) d = dim;
        n = bound(n, 0, 600);
        uint256 start = refToTs(y, m, d, 86399);
        assertEq(h.add(uint64(start), MONTHLY, n), refMonthly(start, n));
    }

    // ------------------------------------------------------------ M-MATH-05 leap year + month lengths
    function test_Math05_LeapYear_1900To2500_MatchesIndependentRuleAndCount() public view {
        uint256 leapCount;
        for (uint256 y = 1900; y <= 2500; ++y) {
            bool expected = (y % 4 == 0); // sequential-override formulation of the Gregorian rule
            if (y % 100 == 0) expected = false;
            if (y % 400 == 0) expected = true;
            assertEq(h.isLeap(y), expected, "isLeap");
            assertEq(expected, refLeap(y), "oracle self-check");
            if (expected) ++leapCount;
            uint256 total;
            for (uint256 m = 1; m <= 12; ++m) total += h.daysInMonth(y, m);
            assertEq(total, expected ? 366 : 365, "year length");
            assertEq(h.daysInMonth(y, 2), expected ? 29 : 28, "february");
        }
        // 151 multiples of four in [1900, 2500]; 7 centuries of which only 2000 and 2400 are leap -> 146
        assertEq(leapCount, 146);
        assertFalse(h.isLeap(1900));
        assertTrue(h.isLeap(2000));
        assertFalse(h.isLeap(2100));
        assertFalse(h.isLeap(2200));
        assertFalse(h.isLeap(2300));
        assertTrue(h.isLeap(2400));
        assertFalse(h.isLeap(2500));
        assertTrue(h.isLeap(2024));
        assertFalse(h.isLeap(2023));
    }

    function test_Math05_DaysInMonthTableAndInvalidDates() public {
        uint8[12] memory expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        for (uint256 m = 1; m <= 12; ++m) {
            assertEq(h.daysInMonth(2027, m), expected[m - 1]);
            assertEq(h.daysInMonth(2028, m), m == 2 ? 29 : expected[m - 1]);
        }
        assertEq(h.daysInMonth(1, 1), 31);
        assertEq(h.daysInMonth(9999, 12), 31);
        vm.expectRevert(ScheduleMath.InvalidDate.selector);
        h.daysInMonth(0, 1);
        vm.expectRevert(ScheduleMath.InvalidDate.selector);
        h.daysInMonth(10000, 1);
        vm.expectRevert(ScheduleMath.InvalidDate.selector);
        h.daysInMonth(2027, 0);
        vm.expectRevert(ScheduleMath.InvalidDate.selector);
        h.daysInMonth(2027, 13);
    }

    // ------------------------------------------------------------ M-MATH-06 firstPeriodAfter smallest n
    /// @dev Core property: reference(n) > afterTs and (n == 0 or reference(n-1) <= afterTs).
    function _assertSmallest(uint64 start, ScheduleMath.Frequency f, uint256 afterTs) internal view returns (uint256 n) {
        n = h.firstPeriodAfter(start, f, afterTs);
        assertGt(refAdd(start, f, n), afterTs, "period n not after cutoff");
        if (n > 0) assertLe(refAdd(start, f, n - 1), afterTs, "n not smallest");
        if (afterTs < start) assertEq(n, 0, "before start");
    }

    function test_Math06_FixedBoundaries() public view {
        uint64 s = refTs(2027, 1, 31, 9, 0, 0);
        assertEq(h.firstPeriodAfter(s, DAILY, s - 1), 0);
        assertEq(h.firstPeriodAfter(s, DAILY, s), 1);
        assertEq(h.firstPeriodAfter(s, DAILY, s + 86399), 1);
        assertEq(h.firstPeriodAfter(s, DAILY, s + 86400), 2);
        assertEq(h.firstPeriodAfter(s, WEEKLY, s + 604799), 1);
        assertEq(h.firstPeriodAfter(s, WEEKLY, s + 604800), 2);
        assertEq(h.firstPeriodAfter(s, MONTHLY, s - 1), 0);
        assertEq(h.firstPeriodAfter(s, MONTHLY, s), 1);
        assertEq(h.firstPeriodAfter(s, MONTHLY, refTs(2027, 2, 28, 8, 59, 59)), 1);
        assertEq(h.firstPeriodAfter(s, MONTHLY, refTs(2027, 2, 28, 9, 0, 0)), 2);
        assertEq(h.firstPeriodAfter(s, MONTHLY, refTs(2027, 3, 15, 0, 0, 0)), 2);
        assertEq(h.firstPeriodAfter(s, MONTHLY, refTs(2027, 3, 31, 9, 0, 0)), 3);
        assertEq(h.firstPeriodAfter(s, MONTHLY, refTs(2027, 4, 1, 0, 0, 0)), 3);
    }

    function testFuzz_Math06_DailyWeeklyAfterCutoff(uint256 rawStart, uint256 delta, bool before, bool weekly)
        public view
    {
        uint64 start = uint64(bound(rawStart, 1, 4_000_000_000));
        delta = bound(delta, 0, 5000 days);
        uint256 afterTs = before ? start - (delta % start) : uint256(start) + delta;
        ScheduleMath.Frequency f = weekly ? WEEKLY : DAILY;
        uint256 n = _assertSmallest(start, f, afterTs);
        if (afterTs >= start && delta < 500 days) {
            assertEq(n, refFirstAfter(start, f, afterTs, 600), "linear scan");
        }
    }

    function testFuzz_Math06_MonthlyAfterCutoff(uint256 y, uint256 m, uint256 d, uint256 sod, uint256 delta, bool before)
        public view
    {
        y = bound(y, 1970, 2400);
        m = bound(m, 1, 12);
        d = bound(d, 27, 31);
        if (d > refDim(y, m)) d = refDim(y, m);
        sod = bound(sod, 0, 86399);
        uint64 start = uint64(refToTs(y, m, d, sod));
        delta = bound(delta, 0, 1500 days);
        uint256 afterTs = before ? start - (delta % (start == 0 ? 1 : start)) : uint256(start) + delta;
        uint256 n = _assertSmallest(start, MONTHLY, afterTs);
        if (afterTs >= start) assertEq(n, refFirstAfter(start, MONTHLY, afterTs, 80), "linear scan");
    }

    function testFuzz_Math06_ExactBoundary(uint256 rawStart, uint256 k, uint8 rawF) public view {
        ScheduleMath.Frequency f = _freq(rawF);
        uint64 start = uint64(bound(rawStart, 1, 3_000_000_000));
        k = bound(k, 0, 700);
        uint256 due = refAdd(start, f, k);
        // exactly ON period k: strictly-after semantics gives k + 1
        assertEq(h.firstPeriodAfter(start, f, due), k + 1, "on boundary");
        // one second before period k: period k itself (or 0 when that is before the start)
        assertEq(h.firstPeriodAfter(start, f, due - 1), k, "one second before boundary");
        // one second after: still k + 1
        assertEq(h.firstPeriodAfter(start, f, due + 1), k + 1, "one second after boundary");
    }

    function test_Math06_RevertsWhenNoSupportedPeriodRemains() public {
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.firstPeriodAfter(0, DAILY, REF_MAX_TS); // cutoff at/after the horizon
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.firstPeriodAfter(uint64(REF_MAX_TS + 1), DAILY, 0); // anchor outside range
        uint64 s = refTs(9999, 12, 31, 0, 0, 0);
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.firstPeriodAfter(s, DAILY, REF_MAX_TS - 1); // next daily period would be 10000-01-01
        uint64 m = refTs(9999, 6, 15, 0, 0, 0);
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.firstPeriodAfter(m, MONTHLY, refTs(9999, 12, 20, 0, 0, 0)); // after the last (Dec 15) period
        assertEq(h.firstPeriodAfter(m, MONTHLY, refTs(9999, 12, 14, 0, 0, 0)), 6, "last period still reachable");
    }

    // ------------------------------------------------------------ M-MATH-07 overflow / year-9999 limit
    function test_Math07_AnchorBeyondHorizonReverts() public {
        uint64 beyond = uint64(REF_MAX_TS + 1);
        for (uint8 i; i < 3; ++i) {
            vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
            h.add(beyond, _freq(i), 0);
            vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
            h.maxPeriod(beyond, _freq(i));
        }
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(type(uint64).max, MONTHLY, 0);
    }

    function test_Math07_HorizonConstantAndLastSecond() public view {
        assertEq(h.maxTimestamp(), REF_MAX_TS);
        assertEq(REF_MAX_TS, refToTs(9999, 12, 31, 86399));
        uint64 last = uint64(REF_MAX_TS);
        for (uint8 i; i < 3; ++i) {
            assertEq(h.maxPeriod(last, _freq(i)), 0);
            assertEq(h.add(last, _freq(i), 0), last);
        }
    }

    function test_Math07_PeriodBeyondHorizonReverts() public {
        uint64 last = uint64(REF_MAX_TS);
        for (uint8 i; i < 3; ++i) {
            vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
            h.add(last, _freq(i), 1);
        }
        // a daily anchor on 9999-12-31 00:00 has no second period (it would be year 10000)
        uint64 s = refTs(9999, 12, 31, 0, 0, 0);
        assertEq(h.maxPeriod(s, DAILY), 0);
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(s, DAILY, 1);
    }

    function test_Math07_HugeIndexRevertsCleanlyForEveryFrequency() public {
        for (uint8 i; i < 3; ++i) {
            vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
            h.add(1_800_000_000, _freq(i), type(uint256).max);
            vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
            h.add(1_800_000_000, _freq(i), type(uint64).max);
        }
    }

    function test_Math07_MonthlyYear9999Limit() public {
        uint64 s = refTs(9999, 1, 31, 9, 0, 0);
        assertEq(h.maxPeriod(s, MONTHLY), 11);
        assertEq(h.add(s, MONTHLY, 11), refTs(9999, 12, 31, 9, 0, 0));
        assertEq(h.add(s, MONTHLY, 1), refTs(9999, 2, 28, 9, 0, 0));
        assertGt(refMonthly(s, 12), REF_MAX_TS, "oracle: period 12 is in year 10000");
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(s, MONTHLY, 12);
        uint64 dec = refTs(9999, 12, 15, 0, 0, 0);
        assertEq(h.maxPeriod(dec, MONTHLY), 0);
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(dec, MONTHLY, 1);
    }

    function test_Math07_MonthlyFromEpochReachesDecember9999ExactlyAndNoFurther() public {
        uint256 maxP = (9999 - 1970) * 12 + 11;
        assertEq(h.maxPeriod(0, MONTHLY), maxP);
        assertEq(h.add(0, MONTHLY, maxP), refMonthly(0, maxP));
        assertEq(h.add(0, MONTHLY, maxP), refTs(9999, 12, 1, 0, 0, 0));
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(0, MONTHLY, maxP + 1);
    }

    function test_Math07_DailyWeeklyHorizonFromEpoch() public {
        uint256 maxD = REF_MAX_TS / 86400;
        uint256 maxW = REF_MAX_TS / 604800;
        assertEq(h.maxPeriod(0, DAILY), maxD);
        assertEq(h.maxPeriod(0, WEEKLY), maxW);
        assertLe(maxD * 86400, REF_MAX_TS);
        assertGt((maxD + 1) * 86400, REF_MAX_TS);
        assertLe(maxW * 604800, REF_MAX_TS);
        assertGt((maxW + 1) * 604800, REF_MAX_TS);
        assertEq(h.add(0, DAILY, maxD), maxD * 86400);
        assertEq(h.add(0, WEEKLY, maxW), maxW * 604800);
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(0, DAILY, maxD + 1);
        vm.expectRevert(ScheduleMath.DateOutOfRange.selector);
        h.add(0, WEEKLY, maxW + 1);
    }

    // ------------------------------------------------------------ M-MATH-08 frequency enum bounds
    function test_Math08_EnumOrdinalsAndRange() public pure {
        assertEq(uint8(ScheduleMath.Frequency.Daily), 0);
        assertEq(uint8(ScheduleMath.Frequency.Weekly), 1);
        assertEq(uint8(ScheduleMath.Frequency.Monthly), 2);
        assertEq(uint8(type(ScheduleMath.Frequency).max), 2);
    }

    function test_Math08_OutOfRangeFrequencyIsRejectedAtTheAbiBoundary() public {
        uint64 s = refTs(2027, 1, 31, 9, 0, 0);
        for (uint256 raw = 0; raw < 6; ++raw) {
            (bool okAdd, bytes memory rAdd) = address(h).call(abi.encodeWithSelector(h.add.selector, s, raw, 1));
            (bool okFirst,) = address(h).call(abi.encodeWithSelector(h.firstPeriodAfter.selector, s, raw, uint256(s) + 1));
            (bool okMax,) = address(h).call(abi.encodeWithSelector(h.maxPeriod.selector, s, raw));
            bool valid = raw <= 2;
            assertEq(okAdd, valid, "add accepts only 0..2");
            assertEq(okFirst, valid, "firstPeriodAfter accepts only 0..2");
            assertEq(okMax, valid, "maxPeriod accepts only 0..2");
            if (valid) assertEq(abi.decode(rAdd, (uint64)), refAdd(s, ScheduleMath.Frequency(uint8(raw)), 1));
        }
        (bool okBig,) = address(h).call(abi.encodeWithSelector(h.add.selector, s, uint256(type(uint8).max) + 1, 1));
        assertFalse(okBig, "value above uint8 rejected");
    }
}
