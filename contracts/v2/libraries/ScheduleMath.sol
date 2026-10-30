// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ScheduleMath
 * @notice UNAUDITED UTC Gregorian schedule arithmetic. The legacy Automation Registry is never called.
 * @dev All periods are calculated from the original anchor, never a previously clamped date.
 * Uses Howard Hinnant's civil-from-days/days-from-civil algorithms for nonnegative Unix dates.
 */
library ScheduleMath {
    /// @notice Fixed enum ordinals used in approved schedule payloads.
    enum Frequency { Daily, Weekly, Monthly }

    /// @notice Last supported UTC second: 9999-12-31 23:59:59.
    uint64 internal constant MAX_TIMESTAMP = 253402300799;

    /// @notice A timestamp, period or resulting calendar year is outside the supported range.
    error DateOutOfRange();
    /// @notice Month must be in [1,12] and year in [1,9999].
    error InvalidDate();

    /**
     * @notice Returns period n, anchored to start, with monthly end-of-month clamping.
     * @param start UTC Unix anchor within years 1970 through 9999.
     * @param f Daily, Weekly or Monthly.
     * @param n Zero-based period index; zero returns the anchor itself.
     * @return timestamp Due timestamp; unsupported dates revert with DateOutOfRange.
     */
    function add(uint64 start, Frequency f, uint256 n) internal pure returns (uint64 timestamp) {
        if (start > MAX_TIMESTAMP) revert DateOutOfRange();
        if (n > maxPeriod(start, f)) revert DateOutOfRange();
        if (f != Frequency.Monthly) {
            uint256 step = f == Frequency.Daily ? 86400 : 604800;
            return uint64(uint256(start) + n * step);
        }
        (uint256 year, uint256 month, uint256 day) = _civilFromDays(uint256(start) / 86400);
        uint256 months = year * 12 + month - 1 + n;
        year = months / 12;
        month = months % 12 + 1;
        uint256 last = daysInMonth(year, month);
        if (day > last) day = last;
        uint256 result = _daysFromCivil(year, month, day) * 86400 + uint256(start) % 86400;
        if (result > MAX_TIMESTAMP || result > type(uint64).max) revert DateOutOfRange();
        return uint64(result);
    }

    /**
     * @notice Finds the smallest n for which add(start,f,n) is strictly after afterTs.
     * @dev Uses a closed-form estimate and at most one correction in each direction; no period loop.
     * Reverts if no supported boundary exists strictly after afterTs.
     * @param start Original effective anchor.
     * @param f Schedule frequency.
     * @param afterTs Exclusive UTC cutoff.
     * @return n First period strictly after the cutoff.
     */
    function firstPeriodAfter(uint64 start, Frequency f, uint256 afterTs) internal pure returns (uint256 n) {
        if (start > MAX_TIMESTAMP || afterTs >= MAX_TIMESTAMP) revert DateOutOfRange();
        if (afterTs < start) return 0;
        if (f != Frequency.Monthly) {
            uint256 step = f == Frequency.Daily ? 86400 : 604800;
            n = (afterTs - start) / step + 1;
        } else {
            (uint256 sy, uint256 sm,) = _civilFromDays(uint256(start) / 86400);
            (uint256 ay, uint256 am,) = _civilFromDays(afterTs / 86400);
            n = (ay - sy) * 12 + am - sm;
            if (add(start, f, n) <= afterTs) ++n;
            else if (n != 0 && add(start, f, n - 1) > afterTs) --n;
        }
        if (n > maxPeriod(start, f)) revert DateOutOfRange();
    }

    /**
     * @notice Largest representable zero-based period for an anchor.
     * @dev Lets callers terminate gracefully at the calendar horizon rather than revert after payment.
     * @param start Original UTC anchor.
     * @param f Schedule frequency.
     * @return n Last supported period index.
     */
    function maxPeriod(uint64 start, Frequency f) internal pure returns (uint256 n) {
        if (start > MAX_TIMESTAMP) revert DateOutOfRange();
        if (f == Frequency.Daily) return (MAX_TIMESTAMP - start) / 86400;
        if (f == Frequency.Weekly) return (MAX_TIMESTAMP - start) / 604800;
        (uint256 year, uint256 month,) = _civilFromDays(uint256(start) / 86400);
        return (9999 - year) * 12 + 12 - month;
    }

    /**
     * @notice Returns the Gregorian month length.
     * @param year Supported calendar year, 1 through 9999.
     * @param month Calendar month, 1 through 12.
     * @return daysCount Number of days in the month.
     */
    function daysInMonth(uint256 year, uint256 month) internal pure returns (uint256 daysCount) {
        if (year == 0 || year > 9999 || month == 0 || month > 12) revert InvalidDate();
        if (month == 2) return isLeap(year) ? 29 : 28;
        return month == 4 || month == 6 || month == 9 || month == 11 ? 30 : 31;
    }

    /**
     * @notice Applies the proleptic Gregorian leap-year rule.
     * @param year Calendar year.
     * @return leap True for multiples of four except centuries not divisible by 400.
     */
    function isLeap(uint256 year) internal pure returns (bool leap) {
        return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    }

    /// @dev Hinnant civil_from_days, with the Unix epoch shifted to the civil era origin.
    function _civilFromDays(uint256 z) private pure returns (uint256 year, uint256 month, uint256 day) {
        z += 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        year = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        day = doy - (153 * mp + 2) / 5 + 1;
        month = mp < 10 ? mp + 3 : mp - 9;
        if (month <= 2) ++year;
    }

    /// @dev Hinnant days_from_civil; inputs are validated post-epoch dates.
    function _daysFromCivil(uint256 year, uint256 month, uint256 day) private pure returns (uint256) {
        if (month <= 2) --year;
        uint256 era = year / 400;
        uint256 yoe = year - era * 400;
        uint256 mp = month > 2 ? month - 3 : month + 9;
        uint256 doy = (153 * mp + 2) / 5 + day - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }
}
