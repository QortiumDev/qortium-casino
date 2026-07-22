package org.qortium.at.casino;

import org.ciyam.at.API;
import org.ciyam.at.CompilationException;
import org.ciyam.at.FunctionCode;
import org.ciyam.at.MachineState;
import org.ciyam.at.OpCode;

import java.nio.ByteBuffer;
import java.util.Arrays;

import static org.ciyam.at.OpCode.calcOffset;

/**
 * Creation-bytes builder for the Previewnet SMPL "free sample" faucet AT.
 * <p>
 * Pays exactly 1 SMPL per account, once ever, enforced on-chain via the AT's
 * persistent map (spec: docs/FAUCET_AT_V1_SMPL.md). The per-claim ordering is
 * consensus-critical and must not be reordered:
 * <ol>
 * <li>GET claim marker — nonzero means already claimed, ignore;</li>
 * <li>balance check — underfunded claims are ignored WITHOUT writing a marker;</li>
 * <li>SET marker = 1;</li>
 * <li>GET readback — zero means the SET was cap-rejected, ignore (no payment);</li>
 * <li>PAY the grant to the sender.</li>
 * </ol>
 * A failed map write must never pay, and a payment must never precede its marker.
 */
public class FaucetV1 {

    /** Chain asset amounts are 1e8-scaled raw units (Amounts.MULTIPLIER), even for indivisible assets. */
    public static final long AMOUNT_MULTIPLIER = 100_000_000L;
    public static final long DEFAULT_GRANT_SMPL = 1L;
    public static final long DEFAULT_GRANT_AMOUNT = DEFAULT_GRANT_SMPL * AMOUNT_MULTIPLIER;

    /** Claim marker stored in the map; must be nonzero because a zero SET deletes the entry. */
    public static final long CLAIM_MARKER = 1L;

    /* Qortium platform functions. These are deliberately raw: CIYAM AT does not define them. */
    private static final short SLEEP_UNTIL_MESSAGE = (short) 0x0503;
    private static final short GET_CONFIGURED_ASSET_ID = (short) 0x0530;
    private static final short GET_ASSET_BALANCE = (short) 0x0531;
    private static final short PAY_ASSET_AMOUNT_TO_B = (short) 0x0533;
    private static final short GET_MAP_VALUE_KEYS_IN_A = (short) 0x0600;
    private static final short SET_MAP_VALUE_KEYS_IN_A = (short) 0x0601;

    private FaucetV1() {
    }

    /**
     * Returns creation bytes for a faucet that pays {@code grantAmount} of the configured asset
     * exactly once per sender, recording claims in the AT's persistent map.
     * The deployed AT's configured working asset must be SMPL.
     */
    public static byte[] buildCreationBytes(long grantAmount) {
        if (grantAmount <= 0)
            throw new IllegalArgumentException("Grant amount must be positive");

        int addrCounter = 0;

        final int addrGrantAmount = addrCounter++;
        final int addrLastTxnTimestamp = addrCounter++;
        final int addrResult = addrCounter++;
        final int addrTxnType = addrCounter++;
        final int addrMessageTxnType = addrCounter++;
        final int addrAssetId = addrCounter++;
        final int addrAssetBalance = addrCounter++;
        // Saved sender address (A1..A4); MUST stay four consecutive slots — SHA256_INTO_B hashes them in place.
        final int addrSender1 = addrCounter++;
        final int addrSender2 = addrCounter++;
        final int addrSender3 = addrCounter++;
        final int addrSender4 = addrCounter++;
        final int addrSenderStartIndex = addrCounter++;
        final int addrSenderByteLength = addrCounter++;
        final int addrMapKey1 = addrCounter++;
        final int addrMapKey2 = addrCounter++;
        final int addrMapValue = addrCounter++;
        final int addrMarkerOne = addrCounter++;

        ByteBuffer dataByteBuffer = ByteBuffer.allocate(addrCounter * MachineState.VALUE_SIZE);
        dataByteBuffer.putLong(addrGrantAmount * MachineState.VALUE_SIZE, grantAmount);
        dataByteBuffer.putLong(addrMessageTxnType * MachineState.VALUE_SIZE, API.ATTransactionType.MESSAGE.value);
        dataByteBuffer.putLong(addrSenderStartIndex * MachineState.VALUE_SIZE, addrSender1);
        dataByteBuffer.putLong(addrSenderByteLength * MachineState.VALUE_SIZE, 32L);
        dataByteBuffer.putLong(addrMarkerOne * MachineState.VALUE_SIZE, CLAIM_MARKER);

        Integer labelSleepLoop = null;
        Integer labelTxnLoop = null;
        Integer labelNonCreator = null;
        Integer labelUnclaimed = null;
        Integer labelFunded = null;
        Integer labelMarkerStored = null;

        ByteBuffer codeByteBuffer = ByteBuffer.allocate(512);

        // Two passes resolve forward branch offsets, as in the lottery builders.
        for (int pass = 0; pass < 2; ++pass) {
            codeByteBuffer.clear();

            try {
                // First run starts scanning after the AT creation transaction.
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_CREATION_TIMESTAMP, addrLastTxnTimestamp));

                labelSleepLoop = codeByteBuffer.position();
                putExtFunDat(codeByteBuffer, SLEEP_UNTIL_MESSAGE, addrLastTxnTimestamp);

                labelTxnLoop = codeByteBuffer.position();
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.PUT_TX_AFTER_TIMESTAMP_INTO_A, addrLastTxnTimestamp));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.CHECK_A_IS_ZERO, addrResult));
                codeByteBuffer.put(OpCode.BNZ_DAT.compile(addrResult, calcOffset(codeByteBuffer, labelSleepLoop)));

                // Advance before filtering so every incoming transaction is considered only once.
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_TIMESTAMP_FROM_TX_IN_A, addrLastTxnTimestamp));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_TYPE_FROM_TX_IN_A, addrTxnType));
                codeByteBuffer.put(OpCode.BNE_DAT.compile(addrTxnType, addrMessageTxnType, calcOffset(codeByteBuffer, labelTxnLoop)));

                // MESSAGE: retain sender in A while comparing it with the creator in B.
                codeByteBuffer.put(OpCode.EXT_FUN.compile(FunctionCode.PUT_ADDRESS_FROM_TX_IN_A_INTO_B));
                codeByteBuffer.put(OpCode.EXT_FUN.compile(FunctionCode.SWAP_A_AND_B));
                codeByteBuffer.put(OpCode.EXT_FUN.compile(FunctionCode.PUT_CREATOR_INTO_B));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.CHECK_A_EQUALS_B, addrResult));
                codeByteBuffer.put(OpCode.BZR_DAT.compile(addrResult, calcOffset(codeByteBuffer, labelNonCreator)));

                // Creator shutdown: return all spendable SMPL, then FIN returns native remainder.
                // Unclaimed map entries are simply abandoned.
                putExtFunRet(codeByteBuffer, GET_CONFIGURED_ASSET_ID, addrAssetId);
                putExtFunRetDat(codeByteBuffer, GET_ASSET_BALANCE, addrAssetBalance, addrAssetId);
                putExtFunRetDat2(codeByteBuffer, PAY_ASSET_AMOUNT_TO_B, addrResult, addrAssetId, addrAssetBalance);
                codeByteBuffer.put(OpCode.FIN_IMD.compile());

                labelNonCreator = codeByteBuffer.position();
                // Save the sender (still in A): A gets clobbered below and B is needed for the payment.
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_A1, addrSender1));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_A2, addrSender2));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_A3, addrSender3));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_A4, addrSender4));

                // Claim key: first 16 bytes of SHA256 over the sender address bytes as packed in A.
                // (CIYAM has no SHA256-of-A function; SHA256_INTO_B hashes data-segment bytes, so it
                // hashes the four saved sender slots — byte-identical to A's packed contents.)
                codeByteBuffer.put(OpCode.EXT_FUN_DAT_2.compile(FunctionCode.SHA256_INTO_B, addrSenderStartIndex, addrSenderByteLength));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_B1, addrMapKey1));
                codeByteBuffer.put(OpCode.EXT_FUN_RET.compile(FunctionCode.GET_B2, addrMapKey2));

                // Ordering invariant step 1: GET claim marker (all-zero B reads our own map).
                codeByteBuffer.put(OpCode.EXT_FUN.compile(FunctionCode.CLEAR_B));
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_A1, addrMapKey1));
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_A2, addrMapKey2));
                putExtFunRet(codeByteBuffer, GET_MAP_VALUE_KEYS_IN_A, addrMapValue);
                codeByteBuffer.put(OpCode.BZR_DAT.compile(addrMapValue, calcOffset(codeByteBuffer, labelUnclaimed)));
                codeByteBuffer.put(OpCode.JMP_ADR.compile(labelTxnLoop)); // already claimed: ignore

                labelUnclaimed = codeByteBuffer.position();
                // Ordering invariant step 2: underfunded claims are ignored WITHOUT writing a marker,
                // so claims resume after a top-up.
                putExtFunRet(codeByteBuffer, GET_CONFIGURED_ASSET_ID, addrAssetId);
                putExtFunRetDat(codeByteBuffer, GET_ASSET_BALANCE, addrAssetBalance, addrAssetId);
                codeByteBuffer.put(OpCode.BGE_DAT.compile(addrAssetBalance, addrGrantAmount, calcOffset(codeByteBuffer, labelFunded)));
                codeByteBuffer.put(OpCode.JMP_ADR.compile(labelTxnLoop)); // unfunded: ignore, no marker

                labelFunded = codeByteBuffer.position();
                // Ordering invariant step 3: SET marker = 1 (A1/A2 still hold the claim key).
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_A4, addrMarkerOne));
                putExtFun(codeByteBuffer, SET_MAP_VALUE_KEYS_IN_A);

                // Ordering invariant step 4: readback — a cap-rejected SET is a silent no-op,
                // so a zero readback means no marker was stored and we must not pay.
                codeByteBuffer.put(OpCode.EXT_FUN.compile(FunctionCode.CLEAR_B));
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_A1, addrMapKey1)); // defensive re-set
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_A2, addrMapKey2));
                putExtFunRet(codeByteBuffer, GET_MAP_VALUE_KEYS_IN_A, addrMapValue);
                codeByteBuffer.put(OpCode.BNZ_DAT.compile(addrMapValue, calcOffset(codeByteBuffer, labelMarkerStored)));
                codeByteBuffer.put(OpCode.JMP_ADR.compile(labelTxnLoop)); // cap-rejected: no payment

                labelMarkerStored = codeByteBuffer.position();
                // Ordering invariant step 5: pay the grant to the saved sender.
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_B1, addrSender1));
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_B2, addrSender2));
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_B3, addrSender3));
                codeByteBuffer.put(OpCode.EXT_FUN_DAT.compile(FunctionCode.SET_B4, addrSender4));
                putExtFunRetDat2(codeByteBuffer, PAY_ASSET_AMOUNT_TO_B, addrResult, addrAssetId, addrGrantAmount);
                codeByteBuffer.put(OpCode.JMP_ADR.compile(labelTxnLoop));
            } catch (CompilationException e) {
                throw new IllegalStateException("Unable to compile faucet AT", e);
            }
        }

        codeByteBuffer.flip();
        byte[] codeBytes = new byte[codeByteBuffer.limit()];
        codeByteBuffer.get(codeBytes);

        final short ciyamAtVersion = 2;
        final short numCallStackPages = 0;
        final short numUserStackPages = 0;
        final long minActivationAmount = 0L;

        return MachineState.toCreationBytes(ciyamAtVersion, codeBytes, dataByteBuffer.array(),
                numCallStackPages, numUserStackPages, minActivationAmount);
    }

    private static void putExtFun(ByteBuffer code, short functionCode) {
        code.put(OpCode.EXT_FUN.value).putShort(functionCode);
    }

    private static void putExtFunDat(ByteBuffer code, short functionCode, int sourceAddress) {
        code.put(OpCode.EXT_FUN_DAT.value).putShort(functionCode).putInt(sourceAddress);
    }

    private static void putExtFunRet(ByteBuffer code, short functionCode, int destinationAddress) {
        code.put(OpCode.EXT_FUN_RET.value).putShort(functionCode).putInt(destinationAddress);
    }

    private static void putExtFunRetDat(ByteBuffer code, short functionCode, int destinationAddress, int sourceAddress) {
        code.put(OpCode.EXT_FUN_RET_DAT.value).putShort(functionCode).putInt(destinationAddress).putInt(sourceAddress);
    }

    private static void putExtFunRetDat2(ByteBuffer code, short functionCode, int destinationAddress, int sourceAddress1, int sourceAddress2) {
        code.put(OpCode.EXT_FUN_RET_DAT_2.value).putShort(functionCode).putInt(destinationAddress)
                .putInt(sourceAddress1).putInt(sourceAddress2);
    }

    public static void main(String[] args) {
        // Arg is in whole SMPL; the builder wants raw 1e8-scaled units.
        long grantAmount = args.length == 0 ? DEFAULT_GRANT_AMOUNT : Long.parseLong(args[0]) * AMOUNT_MULTIPLIER;
        byte[] creationBytes = buildCreationBytes(grantAmount);

        System.out.println("Base58: " + base58Encode(creationBytes));
        System.out.println("Hex: " + hexEncode(creationBytes));
    }

    static String base58Encode(byte[] bytes) {
        final char[] alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".toCharArray();
        byte[] input = Arrays.copyOf(bytes, bytes.length);
        int zeroCount = 0;
        while (zeroCount < input.length && input[zeroCount] == 0)
            ++zeroCount;

        byte[] encoded = new byte[input.length * 2];
        int encodedOffset = encoded.length;
        for (int offset = zeroCount; offset < input.length;) {
            int remainder = 0;
            for (int i = offset; i < input.length; ++i) {
                int value = remainder * 256 + (input[i] & 0xff);
                input[i] = (byte) (value / 58);
                remainder = value % 58;
            }
            if (input[offset] == 0)
                ++offset;
            encoded[--encodedOffset] = (byte) alphabet[remainder];
        }

        while (encodedOffset < encoded.length && encoded[encodedOffset] == (byte) alphabet[0])
            ++encodedOffset;
        while (zeroCount-- > 0)
            encoded[--encodedOffset] = (byte) alphabet[0];

        return new String(encoded, encodedOffset, encoded.length - encodedOffset);
    }

    static String hexEncode(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte value : bytes)
            hex.append(String.format("%02x", value & 0xff));
        return hex.toString();
    }
}
