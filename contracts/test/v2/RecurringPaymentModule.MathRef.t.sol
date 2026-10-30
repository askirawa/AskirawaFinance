// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ScheduleMath} from "../../v2/libraries/ScheduleMath.sol";

/// @notice External wrapper so reverts of the internal library can be asserted with vm.expectRevert.
contract ScheduleMathHarness {
    function add(uint64 start, ScheduleMath.Frequency f, uint256 n) external pure returns (uint64) {
        return ScheduleMath.add(start, f, n);
    }

    function firstPeriodAfter(uint64 start, ScheduleMath.Frequency f, uint256 afterTs) external pure returns (uint256) {
        return ScheduleMath.firstPeriodAfter(start, f, afterTs);
    }

    function maxPeriod(uint64 start, ScheduleMath.Frequency f) external pure returns (uint256) {
        return ScheduleMath.maxPeriod(start, f);
    }

    function daysInMonth(uint256 year, uint256 month) external pure returns (uint256) {
        return ScheduleMath.daysInMonth(year, month);
    }

    function isLeap(uint256 year) external pure returns (bool) {
        return ScheduleMath.isLeap(year);
    }

    function maxTimestamp() external pure returns (uint64) {
        return ScheduleMath.MAX_TIMESTAMP;
    }
}

/// @notice Deliberately naive, independent civil-calendar reference. Algorithms intentionally differ from
/// ScheduleMath (which uses closed-form Hinnant day arithmetic):
///   - decoding walks year by year, then month by month, subtracting lengths (day-by-day calendar);
///   - encoding sums whole years and months from 1970;
///   - monthly period n is found by stepping the (year, month) pair n times from the anchor;
///   - month lengths come from a literal table (not branching on month number).
/// Only integer arithmetic is used. Valid for all years >= 1970 (no 9999 clamp: callers check bounds).
abstract contract ScheduleRef {
    uint256 internal constant REF_MAX_TS = 253402300799; // 9999-12-31 23:59:59 UTC (well-known constant)
    bytes12 internal constant REF_DIM = hex"1f1c1f1e1f1e1f1f1e1f1e1f"; // 31,28,31,30,31,30,31,31,30,31,30,31

    /// @dev Century years are leap only when the century count is a multiple of four.
    function refLeap(uint256 y) internal pure returns (bool) {
        if (y % 4 != 0) return false;
        if (y % 100 != 0) return true;
        return (y / 100) % 4 == 0;
    }

    function refDim(uint256 y, uint256 m) internal pure returns (uint256) {
        if (m == 2 && refLeap(y)) return 29;
        return uint8(REF_DIM[m - 1]);
    }

    /// @dev Year-by-year then month-by-month decode of a Unix timestamp.
    function refCivil(uint256 ts) internal pure returns (uint256 y, uint256 m, uint256 d, uint256 sod) {
        uint256 rem = ts / 86400;
        sod = ts % 86400;
        y = 1970;
        while (true) {
            uint256 yl = refLeap(y) ? 366 : 365;
            if (rem < yl) break;
            rem -= yl;
            ++y;
        }
        m = 1;
        while (rem >= refDim(y, m)) {
            rem -= refDim(y, m);
            ++m;
        }
        d = rem + 1;
    }

    /// @dev Sums whole years then months since 1970-01-01 (day-count encode).
    function refToTs(uint256 y, uint256 m, uint256 d, uint256 sod) internal pure returns (uint256) {
        uint256 dayCount;
        for (uint256 yy = 1970; yy < y; ++yy) dayCount += refLeap(yy) ? 366 : 365;
        for (uint256 mm = 1; mm < m; ++mm) dayCount += refDim(y, mm);
        dayCount += d - 1;
        return dayCount * 86400 + sod;
    }

    function refTs(uint256 y, uint256 m, uint256 d, uint256 hh, uint256 mi, uint256 ss) internal pure returns (uint64) {
        return uint64(refToTs(y, m, d, hh * 3600 + mi * 60 + ss));
    }

    /// @dev Month-by-month stepping with clamp to the anchor day (never to the previous clamped day).
    function refMonthly(uint256 start, uint256 n) internal pure returns (uint256) {
        (uint256 y, uint256 m, uint256 d, uint256 sod) = refCivil(start);
        for (uint256 i; i < n; ++i) {
            ++m;
            if (m == 13) {
                m = 1;
                ++y;
            }
        }
        uint256 dim = refDim(y, m);
        return refToTs(y, m, d < dim ? d : dim, sod);
    }

    /// @dev Daily/weekly advance by repeated addition of one period for small n.
    function refStep(uint256 start, uint256 stepSeconds, uint256 n) internal pure returns (uint256 ts) {
        ts = start;
        for (uint256 i; i < n; ++i) ts += stepSeconds;
    }

    /// @dev Reference for any frequency using direct formulas (daily/weekly are the plain spec formulas).
    function refAdd(uint256 start, ScheduleMath.Frequency f, uint256 n) internal pure returns (uint256) {
        if (f == ScheduleMath.Frequency.Daily) return start + n * 86400;
        if (f == ScheduleMath.Frequency.Weekly) return start + n * 604800;
        return refMonthly(start, n);
    }

    /// @dev Linear scan for the smallest n with refAdd(n) > afterTs; capped scan for naivety.
    function refFirstAfter(uint256 start, ScheduleMath.Frequency f, uint256 afterTs, uint256 cap)
        internal pure returns (uint256 n)
    {
        while (refAdd(start, f, n) <= afterTs) {
            ++n;
            require(n <= cap, "ref scan cap");
        }
    }
}
