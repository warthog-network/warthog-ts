class ParsedFunds {
    val: bigint;
    decimalPlaces: Uint8Array;

    constructor(val: bigint, decimalPlaces: Uint8Array) {
        this.val = val;
        this.decimalPlaces = decimalPlaces;
    }

    static parse(s: string): ParsedFunds | null {
        const MAX_DIGITS = 20;

        let str = "";
        let digitsAfterDot = 0;
        let dotFound = false;

        for (let char of s) {
            if (char in ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
                if (str.length >= MAX_DIGITS) {
                    return null;
                }
                str += char;
                if (dotFound) {
                    digitsAfterDot++;
                }
            } else if (char === ".") {
                if (dotFound) {
                    return null;
                }
                dotFound = true;
            } else {
                return null;
            }
        }
        if (str.length === 0) {
            return null;
        }

        const val = BigInt(str);

        if (val > BigInt(18446744073709551615n)) {
            return null;
        }

        const decimalPlaces = Uint8Array.from([digitsAfterDot]);
        return new ParsedFunds(val, decimalPlaces);
    }
}
