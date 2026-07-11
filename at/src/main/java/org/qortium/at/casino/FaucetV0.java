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
 * Creation-bytes builder for the Previewnet CHIP faucet AT.
 */
public class FaucetV0 {

    /** Chain asset amounts are 1e8-scaled raw units (Amounts.MULTIPLIER), even for indivisible assets. */
    public static final long AMOUNT_MULTIPLIER = 100_000_000L;
    public static final long DEFAULT_GRANT_CHIPS = 1_000L;
    public static final long DEFAULT_GRANT_AMOUNT = DEFAULT_GRANT_CHIPS * AMOUNT_MULTIPLIER;

    /* Qortium platform functions. These are deliberately raw: CIYAM AT does not define them. */
    private static final short SLEEP_UNTIL_MESSAGE = (short) 0x0503;
    private static final short GET_CONFIGURED_ASSET_ID = (short) 0x0530;
    private static final short GET_ASSET_BALANCE = (short) 0x0531;
    private static final short PAY_ASSET_AMOUNT_TO_B = (short) 0x0533;

    private FaucetV0() {
    }

    /**
     * Returns creation bytes for a faucet that pays {@code grantAmount} whole CHIP per MESSAGE.
     * The deployed AT's configured working asset must be CHIP.
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

        ByteBuffer dataByteBuffer = ByteBuffer.allocate(addrCounter * MachineState.VALUE_SIZE);
        dataByteBuffer.putLong(addrGrantAmount * MachineState.VALUE_SIZE, grantAmount);
        dataByteBuffer.putLong(addrMessageTxnType * MachineState.VALUE_SIZE, API.ATTransactionType.MESSAGE.value);

        Integer labelSleepLoop = null;
        Integer labelTxnLoop = null;
        Integer labelNonCreator = null;
        Integer labelPayout = null;

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

                // Creator shutdown: return all spendable CHIP, then FIN returns native remainder.
                putExtFunRet(codeByteBuffer, GET_CONFIGURED_ASSET_ID, addrAssetId);
                putExtFunRetDat(codeByteBuffer, GET_ASSET_BALANCE, addrAssetBalance, addrAssetId);
                putExtFunRetDat2(codeByteBuffer, PAY_ASSET_AMOUNT_TO_B, addrResult, addrAssetId, addrAssetBalance);
                codeByteBuffer.put(OpCode.FIN_IMD.compile());

                labelNonCreator = codeByteBuffer.position();
                // Restore sender to B after the creator comparison.
                codeByteBuffer.put(OpCode.EXT_FUN.compile(FunctionCode.SWAP_A_AND_B));
                putExtFunRet(codeByteBuffer, GET_CONFIGURED_ASSET_ID, addrAssetId);
                putExtFunRetDat(codeByteBuffer, GET_ASSET_BALANCE, addrAssetBalance, addrAssetId);
                codeByteBuffer.put(OpCode.BGE_DAT.compile(addrAssetBalance, addrGrantAmount, calcOffset(codeByteBuffer, labelPayout)));
                codeByteBuffer.put(OpCode.JMP_ADR.compile(labelTxnLoop));

                labelPayout = codeByteBuffer.position();
                // A normal MESSAGE claim takes about 125 steps, comfortably below the 500-step round limit.
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
        // Arg is in whole chips; the builder wants raw 1e8-scaled units.
        long grantAmount = args.length == 0 ? DEFAULT_GRANT_AMOUNT : Long.parseLong(args[0]) * AMOUNT_MULTIPLIER;
        byte[] creationBytes = buildCreationBytes(grantAmount);

        System.out.println("Base58: " + base58Encode(creationBytes));
        System.out.println("Hex: " + hexEncode(creationBytes));
    }

    private static String base58Encode(byte[] bytes) {
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

    private static String hexEncode(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte value : bytes)
            hex.append(String.format("%02x", value & 0xff));
        return hex.toString();
    }
}
