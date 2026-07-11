import java.nio.charset.StandardCharsets;

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.qortium.crypto.Crypto;
import org.qortium.crypto.MemoryPoW;
import org.qortium.data.transaction.BaseTransactionData;
import org.qortium.data.transaction.MessageTransactionData;
import org.qortium.group.Group;
import org.qortium.transaction.MessageTransaction;
import org.qortium.transaction.Transaction;
import org.qortium.transform.transaction.MessageTransactionTransformer;
import org.qortium.transform.transaction.TransactionTransformer;
import org.qortium.utils.Base58;

/**
 * Builds, MemoryPoW-signs, and serializes a zero-fee Qortium MESSAGE transaction.
 *
 * <p>This deliberately does not construct a Repository or initialize Settings or
 * BlockChain: MESSAGE transactions carry their own nonce, unlike the generic
 * /transactions/mempow/compute API flow.</p>
 */
public final class SendMessageTx {

	private static final int POW_BUFFER_SIZE = 8 * 1024 * 1024;
	private static final int DEFAULT_DIFFICULTY = 12;
	private static final int PRIVATE_KEY_LENGTH = 32;

	private SendMessageTx() {
	}

	public static void main(String[] args) throws Exception {
		if (args.length < 2 || args.length > 3) {
			usage();
			System.exit(2);
		}

		String privateKeyBase58 = System.getenv("PRIVATE_KEY");
		if (privateKeyBase58 == null || privateKeyBase58.isBlank()) {
			System.err.println("PRIVATE_KEY is not set");
			System.exit(2);
		}

		int difficulty = args.length == 3 ? parseDifficulty(args[2]) : DEFAULT_DIFFICULTY;
		byte[] privateKey = Base58.decode(privateKeyBase58);
		if (privateKey == null || privateKey.length != PRIVATE_KEY_LENGTH) {
			throw new IllegalArgumentException("PRIVATE_KEY must be a base58-encoded 32-byte Ed25519 private key");
		}

		byte[] data = args[1].getBytes(StandardCharsets.UTF_8);
		if (data.length < 1 || data.length > MessageTransaction.MAX_DATA_SIZE) {
			throw new IllegalArgumentException("messageText must encode to 1-" + MessageTransaction.MAX_DATA_SIZE + " UTF-8 bytes");
		}

		Ed25519PrivateKeyParameters signingKey = new Ed25519PrivateKeyParameters(privateKey, 0);
		byte[] publicKey = signingKey.generatePublicKey().getEncoded();
		long timestamp = System.currentTimeMillis();

		// Qortium removed last-reference chaining. Its current BaseTransactionData
		// serialization has no reference property, so there is no reference to set.
		BaseTransactionData base = new BaseTransactionData(timestamp, Group.NO_GROUP, publicKey, 0L, null);
		MessageTransactionData transactionData = new MessageTransactionData(
				base,
				Transaction.getVersionByTimestamp(timestamp),
				0,
				args[0],
				0L,
				null,
				data,
				true,
				false);

		System.err.println("computing MESSAGE MemoryPoW nonce (difficulty " + difficulty + ", 8 MiB buffer)...");
		byte[] nonceBytes = MessageTransactionTransformer.toBytes(transactionData);
		MessageTransactionTransformer.clearNonce(nonceBytes);
		transactionData.setNonce(MemoryPoW.compute2(nonceBytes, POW_BUFFER_SIZE, difficulty));

		byte[] bytesForSigning = TransactionTransformer.toBytesForSigning(transactionData);
		transactionData.setSignature(Crypto.sign(signingKey, bytesForSigning));

		System.out.println(Base58.encode(MessageTransactionTransformer.toBytes(transactionData)));
	}

	private static int parseDifficulty(String value) {
		try {
			int difficulty = Integer.parseInt(value);
			if (difficulty < 0 || difficulty > 63)
				throw new IllegalArgumentException("difficulty must be between 0 and 63");
			return difficulty;
		} catch (NumberFormatException e) {
			throw new IllegalArgumentException("difficulty must be an integer", e);
		}
	}

	private static void usage() {
		System.err.println("usage: PRIVATE_KEY=<base58-ed25519-private-key> SendMessageTx <recipientAddress> <messageText> [difficulty]");
	}
}
