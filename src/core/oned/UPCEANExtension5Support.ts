import BarcodeFormat from '../BarcodeFormat';
import BitArray from '../common/BitArray';
import Exception from '../Exception';
import UPCEANReader from './UPCEANReader';
import Result from '../Result';
import ResultPoint from '../ResultPoint';
import ResultMetadataType from '../ResultMetadataType';

export default class UPCEANExtension5Support {
    private CHECK_DIGIT_ENCODINGS = [0x18, 0x14, 0x12, 0x11, 0x0C, 0x06, 0x03, 0x0A, 0x09, 0x05];
    private decodeMiddleCounters = [0, 0, 0, 0];
    private decodeRowStringBuffer = '';


    public decodeRow(rowNumber: number, row: BitArray, extensionStartRange: number[]): Result {
        let result = this.decodeRowStringBuffer;
        let end = this.decodeMiddle(row, extensionStartRange, result);

        let resultString = result.toString();
        let extensionData = UPCEANExtension5Support.parseExtensionString(resultString);

        let resultPoints = [
            new ResultPoint((extensionStartRange[0] + extensionStartRange[1]) / 2.0, rowNumber),
            new ResultPoint(end, rowNumber)
        ];

        let extensionResult = new Result(resultString, null, 0, resultPoints, BarcodeFormat.UPC_EAN_EXTENSION, new Date().getTime());

        if (extensionData != null) {
            extensionResult.putAllMetadata(extensionData);
        }

        return extensionResult;
    }

    public decodeMiddle(row: BitArray, startRange: number[], resultString: string) {
        let counters = this.decodeMiddleCounters;
        counters[0] = 0;
        counters[1] = 0;
        counters[2] = 0;
        counters[3] = 0;
        let end = row.getSize();
        let rowOffset = startRange[1];

        let lgPatternFound = 0;

        for (let x = 0; x < 5 && rowOffset < end; x++) {
            let bestMatch = UPCEANReader.decodeDigit(row, counters, rowOffset, UPCEANReader.L_AND_G_PATTERNS);
            resultString = resultString + '0' + bestMatch % 10;
            for (let counter of counters) {
                rowOffset += counter;
            }
            if (bestMatch >= 10) {
                lgPatternFound |= 1 << (4 - x);
            }
            if (x !== 4) {
                // Read off separator if not last
                rowOffset = row.getNextSet(rowOffset);
                rowOffset = row.getNextUnset(rowOffset);
            }
        }

        if (resultString.length !== 5) {
            throw new Exception(Exception.NotFoundException);
        }

        let checkDigit = this.determineCheckDigit(lgPatternFound);
        if (UPCEANExtension5Support.extensionChecksum(resultString.toString()) !== checkDigit) {
            throw new Exception(Exception.NotFoundException);
        }

        return rowOffset;
    }

    static extensionChecksum(s: string) {
        let length = s.length;
        let sum = 0;
        for (let i = length - 2; i >= 0; i -= 2) {
            sum += s.charAt(i).charCodeAt(0) - '0'.charCodeAt(0);
        }
        sum *= 3;
        for (let i = length - 1; i >= 0; i -= 2) {
            sum += s.charAt(i).charCodeAt(0) - '0'.charCodeAt(0);
        }
        sum *= 3;
        return sum % 10;
    }

    public determineCheckDigit(lgPatternFound: number) {
        for (let d = 0; d < 10; d++) {
            if (lgPatternFound === this.CHECK_DIGIT_ENCODINGS[d]) {
                return d;
            }
        }
        throw new Exception(Exception.NotFoundException);
    }

    static parseExtensionString(raw: string) {
        if (raw.length !== 5) {
            return null;
        }
        let value = UPCEANExtension5Support.parseExtension5String(raw);
        if (value == null) {
            return null;
        }

        return new Map([[ResultMetadataType.SUGGESTED_PRICE, value]]);
    }

    static parseExtension5String(raw: string) {
        let currency;
        switch (raw.charAt(0)) {
            case '0':
                currency = '£';
                break;
            case '5':
                currency = '$';
                break;
            case '9':
                // Reference: http://www.jollytech.com
                switch (raw) {
                    case '90000':
                        // No suggested retail price
                        return null;
                    case '99991':
                        // Complementary
                        return '0.00';
                    case '99990':
                        return 'Used';
                }
                // Otherwise... unknown currency?
                currency = '';
                break;
            default:
                currency = '';
                break;
        }
        let rawAmount = parseInt(raw.substring(1));
        let unitsString = (rawAmount / 100).toString();
        let hundredths = rawAmount % 100;
        let hundredthsString = hundredths < 10 ? '0' + hundredths : hundredths.toString();
        return currency + unitsString + '.' + hundredthsString;
    }
}
