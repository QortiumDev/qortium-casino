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

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * MachineState tests with an in-memory implementation of the Qortium platform functions,
 * including the persistent AT map with a configurable entry cap
 * (cap-rejected SET is a silent no-op, matching Core).
 */
public class FaucetV1Tests {

    private static final long SMPL_ASSET_ID = 3L;
    private static final long GRANT = FaucetV1.DEFAULT_GRANT_AMOUNT;

    @Test
    public void first_claim_pays_exactly_one_smpl_and_records_marker() {
        FaucetHarness harness = new FaucetHarness(GRANT * 5);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();

        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Alice", GRANT);
        assertEquals(100_000_000L, harness.api.payments.get(0).amount);
        assertEquals(GRANT * 4, harness.api.assetBalance);
        assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Alice")));
    }

    @Test
    public void bronze_and_higher_trust_statuses_receive_the_grant() {
        for (long trustStatus : new long[] { FaucetV1.BRONZE_TRUST_STATUS, 2L, 3L }) {
            FaucetHarness harness = new FaucetHarness(GRANT * 2);
            harness.start();
            harness.api.setTrustStatus("Alice", trustStatus);

            harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
            harness.executeRound();

            assertEquals("trust status " + trustStatus + " must be eligible", 1, harness.api.payments.size());
            assertPayment(harness.api.payments.get(0), "Alice", GRANT);
            assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Alice")));
        }
    }

    @Test
    public void unverified_and_suspicious_claims_are_ignored_without_marker_or_payment() {
        for (long trustStatus : new long[] { 0L, -1L }) {
            FaucetHarness harness = new FaucetHarness(GRANT * 2);
            harness.start();
            harness.api.setTrustStatus("Alice", trustStatus);

            harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
            harness.executeRound();

            assertTrue("trust status " + trustStatus + " must not receive a payment", harness.api.payments.isEmpty());
            assertEquals("trust status " + trustStatus + " must not drain the faucet", GRANT * 2, harness.api.assetBalance);
            assertNull("trust status " + trustStatus + " must not write a marker", harness.api.mapValue(claimKey("Alice")));
            assertTrue("trust status " + trustStatus + " must leave the map unchanged", harness.api.map.isEmpty());
        }
    }

    @Test
    public void second_claim_from_same_account_is_ignored() {
        FaucetHarness harness = new FaucetHarness(GRANT * 5);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();

        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Alice", GRANT);
        assertEquals(GRANT * 4, harness.api.assetBalance);
        assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Alice")));
        assertEquals(1, harness.api.map.size());
    }

    @Test
    public void distinct_accounts_each_get_exactly_one_grant() {
        FaucetHarness harness = new FaucetHarness(GRANT * 5);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Bob");
        // Two claims exceed one 500-step round, so the machine is force-slept mid-way
        // and the second claim completes in the next round — settle across rounds.
        harness.settle();

        assertEquals(2, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Alice", GRANT);
        assertPayment(harness.api.payments.get(1), "Bob", GRANT);
        assertEquals(GRANT * 3, harness.api.assetBalance);
        assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Alice")));
        assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Bob")));
    }

    @Test
    public void unfunded_claim_leaves_no_marker_and_same_account_succeeds_after_top_up() {
        FaucetHarness harness = new FaucetHarness(GRANT - 1);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();

        // Ignored without a marker: the account must never be marked claimed-but-unpaid.
        assertTrue(harness.api.payments.isEmpty());
        assertNull(harness.api.mapValue(claimKey("Alice")));
        assertTrue(harness.api.map.isEmpty());
        assertFalse(harness.state.isFinished());
        assertTrue(harness.state.isSleeping());

        harness.api.assetBalance += GRANT;
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();

        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), "Alice", GRANT);
        assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Alice")));
    }

    @Test
    public void cap_full_claim_pays_nothing_and_leaves_no_marker_until_cap_is_raised() {
        FaucetHarness harness = new FaucetHarness(GRANT * 5);
        harness.api.mapEntryCap = 1;
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();
        assertEquals(1, harness.api.payments.size());

        // Cap now full: Bob's SET is silently rejected, so the readback guard must block payment.
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Bob");
        harness.executeRound();

        assertEquals(1, harness.api.payments.size());
        assertNull(harness.api.mapValue(claimKey("Bob")));
        assertEquals(1, harness.api.map.size());
        assertEquals(GRANT * 4, harness.api.assetBalance);
        assertFalse(harness.state.isFinished());

        // Governance raises the cap: Bob can claim now because no marker was recorded.
        harness.api.mapEntryCap = 2;
        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Bob");
        harness.executeRound();

        assertEquals(2, harness.api.payments.size());
        assertPayment(harness.api.payments.get(1), "Bob", GRANT);
        assertEquals(Long.valueOf(FaucetV1.CLAIM_MARKER), harness.api.mapValue(claimKey("Bob")));
    }

    @Test
    public void creator_message_sweeps_balance_and_finishes() {
        FaucetHarness harness = new FaucetHarness(GRANT * 3 + 7);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, FaucetTestAPI.CREATOR);
        harness.executeRound();

        assertTrue(harness.state.isFinished());
        assertEquals(1, harness.api.payments.size());
        assertPayment(harness.api.payments.get(0), FaucetTestAPI.CREATOR, GRANT * 3 + 7);
        assertEquals(0L, harness.api.assetBalance);
        assertTrue(harness.api.nativeRemainderReturned);
        assertTrue("Shutdown must not write any claim marker", harness.api.map.isEmpty());
    }

    @Test
    public void non_message_transaction_types_are_skipped() {
        FaucetHarness harness = new FaucetHarness(GRANT);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.PAYMENT, "Alice");
        harness.executeRound();

        assertTrue(harness.api.payments.isEmpty());
        assertTrue(harness.api.map.isEmpty());
        assertFalse(harness.state.isFinished());
        assertEquals(GRANT, harness.api.assetBalance);
    }

    @Test
    public void successful_claim_round_stays_under_step_budget_with_margin() {
        FaucetHarness harness = new FaucetHarness(GRANT * 5);
        harness.start();

        harness.api.addTransaction(API.ATTransactionType.MESSAGE, "Alice");
        harness.executeRound();
        assertEquals(1, harness.api.payments.size());

        // The full claim round (wake, trust gate, claim incl. the 100-step new-map-entry
        // premium, rescan, sleep) must fit one 500-step round or a claim would split across
        // blocks, changing same-block semantics. Measured: 479 steps in this flat-cost harness.
        int claimSteps = harness.state.getSteps();
        assertTrue("Claim round took no steps?", claimSteps > 0);
        assertTrue("Claim round used " + claimSteps + " steps; budget is 500 and we require margin",
                claimSteps <= 490);
    }

    @Test
    public void builder_output_matches_canonical_artifact() throws Exception {
        Path artifactPath = Paths.get("faucet-v1-creation-bytes.txt");
        assertTrue("Canonical artifact missing: " + artifactPath.toAbsolutePath(), Files.exists(artifactPath));

        String base58 = null;
        String hex = null;
        for (String line : Files.readAllLines(artifactPath, StandardCharsets.UTF_8)) {
            if (line.startsWith("Base58: "))
                base58 = line.substring("Base58: ".length()).trim();
            else if (line.startsWith("Hex: "))
                hex = line.substring("Hex: ".length()).trim();
        }

        byte[] creationBytes = FaucetV1.buildCreationBytes(FaucetV1.DEFAULT_GRANT_AMOUNT);
        assertEquals("Committed hex artifact has drifted from the builder", hex, FaucetV1.hexEncode(creationBytes));
        assertEquals("Committed Base58 artifact has drifted from the builder", base58, FaucetV1.base58Encode(creationBytes));
    }

    private static void assertPayment(Payment payment, String recipient, long amount) {
        assertEquals(SMPL_ASSET_ID, payment.assetId);
        assertEquals(recipient, payment.recipient);
        assertEquals(amount, payment.amount);
    }

    /** First 16 bytes of SHA256 over the 32-byte packed sender address, as two big-endian longs. */
    private static MapKey claimKey(String sender) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(FaucetTestAPI.encodeAddress(sender));
            ByteBuffer byteBuffer = ByteBuffer.wrap(digest);
            return new MapKey(byteBuffer.getLong(), byteBuffer.getLong());
        } catch (NoSuchAlgorithmException e) {
            throw new AssertionError(e);
        }
    }

    private static class FaucetHarness {
        final FaucetTestAPI api;
        final MachineState state;

        FaucetHarness(long smplBalance) {
            this.api = new FaucetTestAPI(SMPL_ASSET_ID, smplBalance);
            this.state = new MachineState(api, QuietLoggerFactory.INSTANCE, FaucetV1.buildCreationBytes(GRANT));
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

        /** Executes rounds until the AT has nothing left to do, as consecutive blocks would. */
        void settle() {
            int rounds = 0;
            do {
                assertTrue("AT did not settle within 10 rounds", ++rounds <= 10);
                executeRound();
            } while (!state.isFinished() && api.willExecute(state));
        }
    }

    private static class FaucetTestAPI extends API {
        static final String CREATOR = "Creator";

        private static final short SLEEP_UNTIL_MESSAGE = (short) 0x0503;
        private static final short GET_CONFIGURED_ASSET_ID = (short) 0x0530;
        private static final short GET_ASSET_BALANCE = (short) 0x0531;
        private static final short PAY_ASSET_AMOUNT_TO_B = (short) 0x0533;
        private static final short GET_TRUST_STATUS_FROM_ACCOUNT_IN_B = (short) 0x0522;
        private static final short GET_MAP_VALUE_KEYS_IN_A = (short) 0x0600;
        private static final short SET_MAP_VALUE_KEYS_IN_A = (short) 0x0601;

        private static final int MAP_ENTRY_STEP_COST = 100;

        final long configuredAssetId;
        long assetBalance;
        long nativeFeeReserve = 100_000L;
        boolean nativeRemainderReturned;
        Long sleepUntilMessageTimestamp;
        int currentBlockHeight = 10;
        int nextTransactionId;
        final List<IncomingTransaction> incomingTransactions = new ArrayList<>();
        final List<Payment> payments = new ArrayList<>();
        final Map<String, Long> trustStatuses = new LinkedHashMap<>();

        /** In-memory stand-in for the AT's persistent map, honoring the per-AT entry cap. */
        final Map<MapKey, Long> map = new LinkedHashMap<>();
        int mapEntryCap = 500;

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

        void setTrustStatus(String address, long trustStatus) {
            trustStatuses.put(address, trustStatus);
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

        Long mapValue(MapKey key) {
            return map.get(key);
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
        public int getOpCodeSteps(OpCode opcode, short rawFunctionCode, MachineState state) {
            // Mirror Core: a map SET that would create a new entry is priced at the map-entry
            // premium instead of the ordinary function-call step cost.
            if (opcode == OpCode.EXT_FUN && rawFunctionCode == SET_MAP_VALUE_KEYS_IN_A) {
                MapKey key = new MapKey(getA1(state), getA2(state));
                boolean wouldCreateEntry = getA4(state) != 0 && !map.containsKey(key) && map.size() < mapEntryCap;
                if (wouldCreateEntry)
                    return MAP_ENTRY_STEP_COST;
            }
            return getOpCodeSteps(opcode);
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
                case GET_TRUST_STATUS_FROM_ACCOUNT_IN_B:
                    expectedParamCount = 0;
                    expectedReturnValue = true;
                    break;
                case GET_MAP_VALUE_KEYS_IN_A:
                    expectedParamCount = 0;
                    expectedReturnValue = true;
                    break;
                case SET_MAP_VALUE_KEYS_IN_A:
                    expectedParamCount = 0;
                    expectedReturnValue = false;
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
                case GET_TRUST_STATUS_FROM_ACCOUNT_IN_B:
                    // Existing test claimants default to BRONZE; individual tests override this
                    // to exercise both eligible and rejected statuses.
                    functionData.returnValue = trustStatuses.getOrDefault(decodeAddress(getB(state)),
                            FaucetV1.BRONZE_TRUST_STATUS);
                    return;
                case GET_MAP_VALUE_KEYS_IN_A:
                    // All-zero B addresses our own map; the faucet never reads a foreign map,
                    // and Core returns 0 for unresolvable targets anyway.
                    if (!isAllZero(getB(state))) {
                        functionData.returnValue = 0L;
                        return;
                    }
                    functionData.returnValue = map.getOrDefault(new MapKey(getA1(state), getA2(state)), 0L);
                    return;
                case SET_MAP_VALUE_KEYS_IN_A: {
                    // Writes always target the calling AT's own map: key A1/A2, value A4,
                    // zero deletes, and a cap-rejected create is a SILENT no-op (as in Core).
                    MapKey key = new MapKey(getA1(state), getA2(state));
                    long value = getA4(state);
                    if (value == 0)
                        map.remove(key);
                    else if (map.containsKey(key) || map.size() < mapEntryCap)
                        map.put(key, value);
                    return;
                }
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

        private static boolean isAllZero(byte[] bytes) {
            for (byte value : bytes)
                if (value != 0)
                    return false;
            return true;
        }

        static byte[] encodeAddress(String address) {
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

    private static class MapKey {
        final long key1;
        final long key2;

        MapKey(long key1, long key2) {
            this.key1 = key1;
            this.key2 = key2;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof MapKey))
                return false;
            MapKey otherKey = (MapKey) other;
            return this.key1 == otherKey.key1 && this.key2 == otherKey.key2;
        }

        @Override
        public int hashCode() {
            return Long.hashCode(key1) * 31 + Long.hashCode(key2);
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
