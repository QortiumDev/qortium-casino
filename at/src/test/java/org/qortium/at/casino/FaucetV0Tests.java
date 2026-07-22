package org.qortium.at.casino;

import org.ciyam.at.API;
import org.ciyam.at.AtLogger;
import org.ciyam.at.AtLoggerFactory;
import org.ciyam.at.ExecutionException;
import org.ciyam.at.FunctionData;
import org.ciyam.at.IllegalFunctionCodeException;
import org.ciyam.at.MachineState;
import org.ciyam.at.OpCode;
import org.ciyam.at.Timestamp;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * MachineState tests with an in-memory implementation of the Qortium platform functions.
 */
public class FaucetV0Tests {

    private static final long CHIP_ASSET_ID = 42L;
    private static final long GRANT = FaucetV0.DEFAULT_GRANT_AMOUNT;

    @Test
    public void message_from_user_pays_exact_grant_amount() {
        FaucetHarness harness = new FaucetHarness(GRANT);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();

        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Alice", GRANT);
        assertEquals(0L, harness.api.assetBalance);
    }

    @Test
    public void two_messages_from_two_users_both_get_paid() {
        FaucetHarness harness = new FaucetHarness(GRANT * 2);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Bob");
        harness.executeRound();

        assertEquals(2, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Alice", GRANT);
        assertPayment(harness.api.payments.get(1), "Bob", GRANT);
        assertEquals(0L, harness.api.assetBalance);
    }

    @Test
    public void low_balance_skips_claim_and_later_top_up_resumes_payouts() {
        FaucetHarness harness = new FaucetHarness(GRANT - 1);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();

        assertTrue(harness.api.payments.isEmpty());
        assertFalse(harness.state.isFinished());
        assertTrue(harness.state.isSleeping());

        harness.api.assetBalance += GRANT;
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Bob");
        harness.executeRound();

        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Bob", GRANT);
        assertEquals(GRANT - 1, harness.api.assetBalance);
    }

    @Test
    public void creator_message_returns_all_chip_and_finishes() {
        FaucetHarness harness = new FaucetHarness(GRANT * 3 + 7);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, FaucetTestAPI.CREATOR);
        harness.executeRound();

        assertTrue(harness.state.isFinished());
        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), FaucetTestAPI.CREATOR, GRANT * 3 + 7);
        assertEquals(0L, harness.api.assetBalance);
        assertTrue(harness.api.nativeRemainderReturned);
    }

    @Test
    public void non_message_transaction_types_are_skipped() {
        FaucetHarness harness = new FaucetHarness(GRANT);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.PAYMENT, "Alice");
        harness.executeRound();

        assertTrue(harness.api.payments.isEmpty());
        assertFalse(harness.state.isFinished());
        assertEquals(GRANT, harness.api.assetBalance);
    }

    private static void assertPayment(Payment payment, String recipient, long amount) {
        assertEquals(CHIP_ASSET_ID, payment.assetId);
        assertEquals(recipient, payment.recipient);
        assertEquals(amount, payment.amount);
    }

    private static class FaucetHarness {
        final FaucetTestAPI api;
        final MachineState state;

        FaucetHarness(long chipBalance) {
            this.api = new FaucetTestAPI(CHIP_ASSET_ID, chipBalance);
            this.state = new MachineState(api, QuietLoggerFactory.INSTANCE, FaucetV0.buildCreationBytes(GRANT));
        }

        void start() {
            executeRound();
            assertTrue(state.isSleeping());
        }

        void executeRound() {
            assertTrue("AT should execute only after an incoming transaction", api.willExecute(state));
            state.execute();
            api.nativeFeeReserve = state.getCurrentBalance();
        }
    }

    private static class FaucetTestAPI extends API {
        static final String CREATOR = "Creator";

        private static final short SLEEP_UNTIL_MESSAGE = (short) 0x0503;
        private static final short GET_CONFIGURED_ASSET_ID = (short) 0x0530;
        private static final short GET_ASSET_BALANCE = (short) 0x0531;
        private static final short PAY_ASSET_AMOUNT_TO_B = (short) 0x0533;

        final long configuredAssetId;
        long assetBalance;
        long nativeFeeReserve = 100_000L;
        boolean nativeRemainderReturned;
        Long sleepUntilMessageTimestamp;
        int currentBlockHeight = 10;
        int nextTransactionId;
        final List<IncomingTransaction> incomingTransactions = new ArrayList<>();
        final List<Payment> payments = new ArrayList<>();

        FaucetTestAPI(long configuredAssetId, long assetBalance) {
            this.configuredAssetId = configuredAssetId;
            this.assetBalance = assetBalance;
        }

        void addTransaction(API.ATTransactionType type, String sender) {
            ++currentBlockHeight;
            byte[] id = new byte[32];
            id[31] = (byte) ++nextTransactionId;
            incomingTransactions.add(new IncomingTransaction(id, Timestamp.toLong(currentBlockHeight, 0), type, sender));
        }

        boolean willExecute(MachineState state) {
            if (!state.isSleeping())
                return true;

            if (sleepUntilMessageTimestamp == null)
                return true;

            for (IncomingTransaction transaction : incomingTransactions)
                if (transaction.timestamp > sleepUntilMessageTimestamp)
                    return true;

            return false;
        }

        @Override
        public int getMaxStepsPerRound() {
            return 500;
        }

        @Override
        public int getOpCodeSteps(OpCode opcode) {
            if (opcode.value >= OpCode.EXT_FUN.value && opcode.value <= OpCode.EXT_FUN_RET_DAT_2.value)
                return 10;
            return 1;
        }

        @Override
        public long getFeePerStep() {
            return 1L;
        }

        @Override
        public int getCurrentBlockHeight() {
            return currentBlockHeight;
        }

        @Override
        public int getATCreationBlockHeight(MachineState state) {
            return 10;
        }

        @Override
        public void putPreviousBlockHashIntoA(MachineState state) {
            setA(state, new byte[32]);
        }

        @Override
        public void putTransactionAfterTimestampIntoA(Timestamp timestamp, MachineState state) {
            for (IncomingTransaction transaction : incomingTransactions) {
                if (transaction.timestamp > timestamp.longValue()) {
                    setA(state, transaction.id);
                    return;
                }
            }
            setA(state, new byte[32]);
        }

        @Override
        public long getTypeFromTransactionInA(MachineState state) {
            IncomingTransaction transaction = transactionFromA(state);
            return transaction == null ? -1L : transaction.type.value;
        }

        @Override
        public long getAmountFromTransactionInA(MachineState state) {
            return 0L;
        }

        @Override
        public long getTimestampFromTransactionInA(MachineState state) {
            IncomingTransaction transaction = transactionFromA(state);
            return transaction == null ? -1L : transaction.timestamp;
        }

        @Override
        public long generateRandomUsingTransactionInA(MachineState state) {
            return 0L;
        }

        @Override
        public void putMessageFromTransactionInAIntoB(MachineState state) {
            zeroB(state);
        }

        @Override
        public void putAddressFromTransactionInAIntoB(MachineState state) {
            IncomingTransaction transaction = transactionFromA(state);
            setB(state, encodeAddress(transaction.sender));
        }

        @Override
        public void putCreatorAddressIntoB(MachineState state) {
            setB(state, encodeAddress(CREATOR));
        }

        @Override
        public long getCurrentBalance(MachineState state) {
            return nativeFeeReserve;
        }

        @Override
        public long payAmountToB(long amount, MachineState state) {
            throw new AssertionError("Faucet must not make a native payment before FIN");
        }

        @Override
        public void messageAToB(MachineState state) {
            throw new AssertionError("Faucet does not send messages");
        }

        @Override
        public long addMinutesToTimestamp(Timestamp timestamp, long minutes, MachineState state) {
            return timestamp.longValue();
        }

        @Override
        public void onFinished(long amount, MachineState state) {
            nativeRemainderReturned = true;
        }

        @Override
        public void onFatalError(MachineState state, ExecutionException e) {
            throw new AssertionError("Unexpected AT execution error", e);
        }

        @Override
        public void platformSpecificPreExecuteCheck(int paramCount, boolean returnValueExpected, MachineState state, short rawFunctionCode)
                throws IllegalFunctionCodeException {
            int expectedParamCount;
            boolean expectedReturnValue;

            switch (rawFunctionCode) {
                case SLEEP_UNTIL_MESSAGE:
                    expectedParamCount = 1;
                    expectedReturnValue = false;
                    break;
                case GET_CONFIGURED_ASSET_ID:
                    expectedParamCount = 0;
                    expectedReturnValue = true;
                    break;
                case GET_ASSET_BALANCE:
                    expectedParamCount = 1;
                    expectedReturnValue = true;
                    break;
                case PAY_ASSET_AMOUNT_TO_B:
                    expectedParamCount = 2;
                    expectedReturnValue = true;
                    break;
                default:
                    throw new IllegalFunctionCodeException("Unknown Qortium function 0x" + String.format("%04x", rawFunctionCode));
            }

            if (paramCount != expectedParamCount || returnValueExpected != expectedReturnValue)
                throw new IllegalFunctionCodeException("Incorrect Qortium function call signature");
        }

        @Override
        public void platformSpecificPostCheckExecute(FunctionData functionData, MachineState state, short rawFunctionCode)
                throws ExecutionException {
            switch (rawFunctionCode) {
                case SLEEP_UNTIL_MESSAGE:
                    sleepUntilMessageTimestamp = functionData.value1;
                    setIsSleeping(state, true);
                    return;
                case GET_CONFIGURED_ASSET_ID:
                    functionData.returnValue = configuredAssetId;
                    return;
                case GET_ASSET_BALANCE:
                    functionData.returnValue = functionData.value1 == configuredAssetId ? assetBalance : -1L;
                    return;
                case PAY_ASSET_AMOUNT_TO_B:
                    if (functionData.value1 != configuredAssetId || functionData.value2 < 0) {
                        functionData.returnValue = -1L;
                        return;
                    }

                    long amount = Math.min(functionData.value2, assetBalance);
                    if (amount > 0) {
                        payments.add(new Payment(decodeAddress(getB(state)), functionData.value1, amount));
                        assetBalance -= amount;
                    }
                    functionData.returnValue = amount;
                    return;
                default:
                    throw new IllegalFunctionCodeException("Unknown Qortium function");
            }
        }

        private IncomingTransaction transactionFromA(MachineState state) {
            byte[] id = getA(state);
            for (IncomingTransaction transaction : incomingTransactions)
                if (Arrays.equals(transaction.id, id))
                    return transaction;
            return null;
        }

        private static byte[] encodeAddress(String address) {
            byte[] encoded = new byte[32];
            byte[] source = address.getBytes(StandardCharsets.US_ASCII);
            System.arraycopy(source, 0, encoded, 0, source.length);
            return encoded;
        }

        private static String decodeAddress(byte[] encoded) {
            int length = encoded.length;
            while (length > 0 && encoded[length - 1] == 0)
                --length;
            return new String(encoded, 0, length, StandardCharsets.US_ASCII);
        }
    }

    private static class IncomingTransaction {
        final byte[] id;
        final long timestamp;
        final API.ATTransactionType type;
        final String sender;

        IncomingTransaction(byte[] id, long timestamp, API.ATTransactionType type, String sender) {
            this.id = id;
            this.timestamp = timestamp;
            this.type = type;
            this.sender = sender;
        }
    }

    private static class Payment {
        final String recipient;
        final long assetId;
        final long amount;

        Payment(String recipient, long assetId, long amount) {
            this.recipient = recipient;
            this.assetId = assetId;
            this.amount = amount;
        }
    }

    private enum QuietLoggerFactory implements AtLoggerFactory {
        INSTANCE;

        @Override
        public AtLogger create(Class<?> ignored) {
            return QuietLogger.INSTANCE;
        }
    }

    private enum QuietLogger implements AtLogger {
        INSTANCE;

        @Override public void error(String ignored) { }
        @Override public void error(java.util.function.Supplier<String> ignored) { }
        @Override public void debug(String ignored) { }
        @Override public void debug(java.util.function.Supplier<String> ignored) { }
        @Override public void echo(String ignored) { }
        @Override public void echo(java.util.function.Supplier<String> ignored) { }
    }
}
