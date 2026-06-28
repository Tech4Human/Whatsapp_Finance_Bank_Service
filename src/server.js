/**
 * Ruby Mock Bank Server
 * Simulates a real bank API for Ruby platform dev testing.
 * Ruby adapters call this server when USE_MOCK_BANK=true
 */

const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const path     = require('path');
const { MockBank, MockAccount, MockOtp, MockTransaction } = require('./models');

require("dotenv").config();
const app  = express();
const PORT = process.env.MOCK_BANK_PORT || 4000;

// ── MongoDB connection ────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI || process.env.MOCK_BANK_MONGO_URI;

if (!MONGO_URI) {
  console.error('❌  MONGODB_URI not set. Copy it from your Ruby .env file.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅  MongoDB connected (same cluster as Ruby)'))
  .catch(err => { console.error('❌  MongoDB error:', err.message); process.exit(1); });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const API_KEY = process.env.MOCK_BANK_API_KEY || 'mock-ruby-dev-2026';

function checkKey(req, res, next) {
  const key = req.headers['x-mock-bank-key'];
  if (key && key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key', code: 'AUTH_001' });
  }
  next();
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path} → ${res.statusCode} (${Date.now()-start}ms)`);
  });
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const BANK_NAMES = {
  '044': 'Access Bank',
  '058': 'GTBank',
  '057': 'Zenith Bank',
  '011': 'First Bank',
  '033': 'UBA',
  '070': 'Fidelity Bank',
  '214': 'First City Monument Bank',
  '215': 'Unity Bank',
  '232': 'Sterling Bank',
  '301': 'Jaiz Bank',
  '050': 'Ecobank Nigeria',
  '035': 'Wema Bank',
  '032': 'Union Bank',
  '221': 'Stanbic IBTC Bank',
  '068': 'Standard Chartered',
  '076': 'Polaris Bank',
  '023': 'Citibank Nigeria',
  '084': 'Enterprise Bank',
  '063': 'Diamond Bank',
  '082': 'Keystone Bank',
};

const PREFIX_MAP = {
  '044': 'ACC', '058': 'GTB', '057': 'ZEN', '011': 'FBN',
  '033': 'UBA', '070': 'FID', '214': 'FCM', '215': 'UNI',
  '232': 'STL', '050': 'ECO',
};

function bankRef(bankCode) {
  const prefix = PREFIX_MAP[bankCode] || 'BNK';
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
}

function fail(res, message, code = 'BANK_001', status = 400) {
  return res.status(status).json({ success: false, error: message, code, timestamp: new Date().toISOString() });
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ruby-mock-bank',
    version: '2.0.0',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BANK API ENDPOINTS — called by Ruby adapters
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. GET /mock-bank/banks ───────────────────────────────────────────────────
// Returns the list of supported banks from MongoDB
app.get('/mock-bank/banks', checkKey, async (req, res) => {
  try {
    const banks = await MockBank.find({ isActive: true }).sort({ bankName: 1 }).lean();
    return ok(res, { banks, total: banks.length });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 2. POST /mock-bank/validate-account ──────────────────────────────────────
// Account validation: resolves account name + generates OTP (step 1 of linking)
app.post('/mock-bank/validate-account', checkKey, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode) {
      return fail(res, 'accountNumber and bankCode are required', 'VAL_001');
    }
    if (accountNumber.length !== 10) {
      return fail(res, 'accountNumber must be exactly 10 digits', 'VAL_002');
    }

    const account = await MockAccount.findOne({ accountNumber, bankCode, isActive: true });

    const prefix  = PREFIX_MAP[bankCode] || 'BNK';
    const otpRef  = `OTP-${prefix}-${Date.now()}`;
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    await MockOtp.create({
      reference:     otpRef,
      accountNumber,
      bankCode,
      code:          otpCode,
      expiresAt:     new Date(Date.now() + 10 * 60000),
    });

    const sandboxName = `${accountNumber.slice(0, 4).toUpperCase()} SANDBOX HOLDER`;

    return ok(res, {
      accountName:  account ? account.accountName  : sandboxName,
      accountType:  account ? account.accountType  : 'savings',
      bankCode,
      bankName:     BANK_NAMES[bankCode] || bankCode,
      otpFlag:      true,
      otpReference: otpRef,
      maskedPhone:  account?.phone || '070****5678',
    });
  } catch (err) {
    console.error('validate-account error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 3. POST /mock-bank/verify-otp ────────────────────────────────────────────
// Account verification: verifies OTP → issues user token (step 2 of linking)
app.post('/mock-bank/verify-otp', checkKey, async (req, res) => {
  try {
    const { otp, otpReference, accountNumber } = req.body;

    if (!otp || !otpReference) {
      return fail(res, 'otp and otpReference are required', 'VAL_001');
    }

    const stored = await MockOtp.findOne({ reference: otpReference });

    // Dev bypass: 123456 always passes in sandbox
    const devBypass = otp === '123456';
    const valid = devBypass || (stored && stored.code === otp && !stored.used && new Date() < stored.expiresAt);

    if (!valid) {
      return fail(res, 'Invalid or expired OTP', 'OTP_001', 401);
    }

    if (stored) {
      stored.used   = true;
      stored.usedAt = new Date();
      await stored.save();
    }

    const userToken = `mock-token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return ok(res, {
      userToken,
      tokenType:      'Bearer',
      tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 4. GET /mock-bank/account-details/:accountNumber ─────────────────────────
// Returns full account details: name, type, BVN mask, tier, KYC status
app.get('/mock-bank/account-details/:accountNumber', checkKey, async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { bankCode } = req.query;

    if (!bankCode) return fail(res, 'bankCode query param is required', 'VAL_001');

    const account = await MockAccount.findOne({ accountNumber, bankCode, isActive: true }).lean();

    if (!account) {
      // Return a sandboxed generic profile for unknown accounts
      return ok(res, {
        accountNumber,
        accountName:  `${accountNumber.slice(0,4).toUpperCase()} SANDBOX HOLDER`,
        accountType:  'savings',
        bankCode,
        bankName:     BANK_NAMES[bankCode] || bankCode,
        currency:     'NGN',
        bvnMask:      '2234****890',
        tier:         'tier3',
        kycStatus:    'verified',
        email:        '',
        phone:        '070****5678',
        isSandbox:    true,
      });
    }

    return ok(res, {
      accountNumber:  account.accountNumber,
      accountName:    account.accountName,
      accountType:    account.accountType,
      bankCode:       account.bankCode,
      bankName:       account.bankName,
      currency:       'NGN',
      bvnMask:        account.bvnMask,
      tier:           account.tier,
      kycStatus:      account.kycStatus,
      email:          account.email,
      phone:          account.phone,
      isSandbox:      false,
    });
  } catch (err) {
    console.error('account-details error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 5. POST /mock-bank/transfer ───────────────────────────────────────────────
// Execute a funds transfer — deducts from source, credits destination
app.post('/mock-bank/transfer', checkKey, async (req, res) => {
  try {
    const {
      reference,
      sourceAccountNumber,
      sourceBankCode,
      recipientAccount,
      recipientBankCode,
      amount,
      narration,
    } = req.body;

    if (!sourceAccountNumber || !amount) {
      return fail(res, 'sourceAccountNumber and amount are required', 'VAL_001');
    }

    // Idempotency: if this ruby reference already has a successful transaction, return it
    if (reference) {
      const existing = await MockTransaction.findOne({ rubyReference: reference, type: 'debit' });
      if (existing) {
        return ok(res, {
          bankReference:   existing.bankReference,
          responseCode:    '00',
          responseMessage: 'Transaction Successful (duplicate — returning original)',
          isDuplicate:     true,
        });
      }
    }

    const source = await MockAccount.findOne({ accountNumber: sourceAccountNumber, bankCode: sourceBankCode, isActive: true });

    if (source) {
      if (source.balanceKobo < amount) {
        return fail(res, 'Insufficient funds', 'BANK_INSUF', 422);
      }
      source.balanceKobo -= amount;
      await source.save();

      const bref = bankRef(sourceBankCode);
      await MockTransaction.create({
        bankReference:       bref,
        rubyReference:       reference,
        type:                'debit',
        accountNumber:       sourceAccountNumber,
        bankCode:            sourceBankCode,
        amountKobo:          amount,
        balanceAfterKobo:    source.balanceKobo,
        narration:           narration || 'Transfer',
        counterpartyAccount: recipientAccount,
        counterpartyBank:    recipientBankCode,
      });
    }

    // Credit destination if it exists in our mock bank
    const dest = await MockAccount.findOne({ accountNumber: recipientAccount, bankCode: recipientBankCode, isActive: true });
    if (dest) {
      dest.balanceKobo += amount;
      await dest.save();
      await MockTransaction.create({
        bankReference:       bankRef(recipientBankCode),
        rubyReference:       reference,
        type:                'credit',
        accountNumber:       recipientAccount,
        bankCode:            recipientBankCode,
        amountKobo:          amount,
        balanceAfterKobo:    dest.balanceKobo,
        narration:           narration || 'Transfer credit',
        counterpartyAccount: sourceAccountNumber,
        counterpartyBank:    sourceBankCode,
      });
    }

    const bref = bankRef(sourceBankCode);
    return ok(res, {
      bankReference:   bref,
      responseCode:    '00',
      responseMessage: 'Transaction Successful',
    });
  } catch (err) {
    console.error('transfer error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 6. GET /mock-bank/transfer-status/:reference ─────────────────────────────
// Query transfer status by Ruby reference or bank reference
app.get('/mock-bank/transfer-status/:reference', checkKey, async (req, res) => {
  try {
    const { reference } = req.params;

    // Search by ruby reference first, then bank reference
    const txn = await MockTransaction.findOne({
      $or: [
        { rubyReference: reference },
        { bankReference: reference },
      ],
      type: { $in: ['debit', 'credit'] },
    }).lean();

    if (!txn) {
      return fail(res, 'Transaction not found', 'TXN_NOT_FOUND', 404);
    }

    return ok(res, {
      bankReference:  txn.bankReference,
      rubyReference:  txn.rubyReference,
      status:         txn.status,
      responseCode:   txn.responseCode,
      type:           txn.type,
      accountNumber:  txn.accountNumber,
      amountKobo:     txn.amountKobo,
      narration:      txn.narration,
      timestamp:      txn.createdAt,
      counterparty: {
        account: txn.counterpartyAccount,
        bank:    txn.counterpartyBank,
      },
    });
  } catch (err) {
    console.error('transfer-status error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 7. GET /mock-bank/balance/:accountNumber ──────────────────────────────────
app.get('/mock-bank/balance/:accountNumber', checkKey, async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { bankCode } = req.query;

    const account = await MockAccount.findOne({ accountNumber, bankCode, isActive: true });
    const balance = account ? account.balanceKobo : 35_000_000;

    return ok(res, { balance, currency: 'NGN' });
  } catch (err) {
    console.error('balance error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 8. POST /mock-bank/airtime ────────────────────────────────────────────────
app.post('/mock-bank/airtime', checkKey, async (req, res) => {
  try {
    const { reference, phoneNumber, amount, network, bankCode, sourceAccountNumber } = req.body;

    if (!amount || !phoneNumber || !network) {
      return fail(res, 'amount, phoneNumber and network are required', 'VAL_001');
    }

    const account = await MockAccount.findOne({ accountNumber: sourceAccountNumber, bankCode, isActive: true });

    if (account) {
      if (account.balanceKobo < amount) {
        return fail(res, 'Insufficient funds', 'BANK_INSUF', 422);
      }
      account.balanceKobo -= amount;
      await account.save();

      await MockTransaction.create({
        bankReference:    bankRef(bankCode),
        rubyReference:    reference,
        type:             'airtime',
        accountNumber:    sourceAccountNumber,
        bankCode,
        amountKobo:       amount,
        balanceAfterKobo: account.balanceKobo,
        narration:        `${network} airtime for ${phoneNumber}`,
        phoneNumber,
        network,
      });
    }

    return ok(res, {
      bankReference: bankRef(bankCode || '044'),
      responseCode:  '00',
      network,
      phoneNumber,
      responseMessage: 'Airtime purchase successful',
    });
  } catch (err) {
    console.error('airtime error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 9. POST /mock-bank/data ───────────────────────────────────────────────────
// Data subscription: phone + network + plan/bundle + amount
app.post('/mock-bank/data', checkKey, async (req, res) => {
  try {
    const { reference, phoneNumber, amount, network, plan, bundle, bankCode, sourceAccountNumber } = req.body;

    if (!amount || !phoneNumber || !network || !plan) {
      return fail(res, 'amount, phoneNumber, network and plan are required', 'VAL_001');
    }

    const account = await MockAccount.findOne({ accountNumber: sourceAccountNumber, bankCode, isActive: true });

    if (account) {
      if (account.balanceKobo < amount) {
        return fail(res, 'Insufficient funds', 'BANK_INSUF', 422);
      }
      account.balanceKobo -= amount;
      await account.save();

      await MockTransaction.create({
        bankReference:    bankRef(bankCode),
        rubyReference:    reference,
        type:             'data',
        accountNumber:    sourceAccountNumber,
        bankCode,
        amountKobo:       amount,
        balanceAfterKobo: account.balanceKobo,
        narration:        `${network} ${bundle || plan} data for ${phoneNumber}`,
        phoneNumber,
        network,
        dataBundle:       bundle,
        dataPlan:         plan,
      });
    }

    return ok(res, {
      bankReference:   bankRef(bankCode || '044'),
      responseCode:    '00',
      network,
      phoneNumber,
      plan,
      bundle:          bundle || null,
      responseMessage: 'Data subscription successful',
    });
  } catch (err) {
    console.error('data error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 10. POST /mock-bank/bill ──────────────────────────────────────────────────
app.post('/mock-bank/bill', checkKey, async (req, res) => {
  try {
    const { reference, billerCode, customerReference, amount, bankCode, sourceAccountNumber, billerName } = req.body;

    if (!amount || !billerCode || !customerReference) {
      return fail(res, 'amount, billerCode and customerReference are required', 'VAL_001');
    }

    const account = await MockAccount.findOne({ accountNumber: sourceAccountNumber, bankCode, isActive: true });

    if (account) {
      if (account.balanceKobo < amount) {
        return fail(res, 'Insufficient funds', 'BANK_INSUF', 422);
      }
      account.balanceKobo -= amount;
      await account.save();

      await MockTransaction.create({
        bankReference:     bankRef(bankCode),
        rubyReference:     reference,
        type:              'bill',
        accountNumber:     sourceAccountNumber,
        bankCode,
        amountKobo:        amount,
        balanceAfterKobo:  account.balanceKobo,
        narration:         `Bill: ${billerName || billerCode} — ${customerReference}`,
        billerCode,
        customerReference,
      });
    }

    return ok(res, {
      bankReference:    bankRef(bankCode || '044'),
      responseCode:     '00',
      responseMessage:  'Bill payment successful',
      billerCode,
      customerReference,
    });
  } catch (err) {
    console.error('bill error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ── 11. GET /mock-bank/statement/:accountNumber ───────────────────────────────
app.get('/mock-bank/statement/:accountNumber', checkKey, async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { bankCode, page = 1, limit = 20 } = req.query;

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const query = { accountNumber, ...(bankCode && { bankCode }) };

    const [txns, total] = await Promise.all([
      MockTransaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      MockTransaction.countDocuments(query),
    ]);

    return ok(res, {
      transactions: txns.map(t => ({
        reference:    t.bankReference,
        type:         t.type,
        amount:       t.amountKobo,
        balanceAfter: t.balanceAfterKobo,
        narration:    t.narration,
        status:       t.status,
        timestamp:    t.createdAt,
      })),
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('statement error:', err);
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD API ENDPOINTS — called by the UI
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/banks
app.get('/api/banks', async (req, res) => {
  try {
    const banks = await MockBank.find({}).sort({ bankName: 1 }).lean();
    return ok(res, banks);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// POST /api/banks
app.post('/api/banks', async (req, res) => {
  try {
    const { bankCode, bankName, shortName, nipCode, ussdCode } = req.body;
    if (!bankCode || !bankName) return fail(res, 'bankCode and bankName are required', 'VAL_001');
    const existing = await MockBank.findOne({ bankCode });
    if (existing) return fail(res, 'Bank code already exists', 'DUPLICATE_001', 409);
    const bank = await MockBank.create({ bankCode, bankName, shortName, nipCode, ussdCode });
    return ok(res, bank, 201);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// PATCH /api/banks/:id/toggle
app.patch('/api/banks/:id/toggle', async (req, res) => {
  try {
    const bank = await MockBank.findById(req.params.id);
    if (!bank) return fail(res, 'Bank not found', 'NOT_FOUND', 404);
    bank.isActive = !bank.isActive;
    await bank.save();
    return ok(res, bank);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// DELETE /api/banks/:id
app.delete('/api/banks/:id', async (req, res) => {
  try {
    await MockBank.findByIdAndDelete(req.params.id);
    return ok(res, { deleted: true });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// GET /api/accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await MockAccount.find({ isActive: true }).sort({ createdAt: -1 }).lean();
    return ok(res, accounts);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// POST /api/accounts
app.post('/api/accounts', async (req, res) => {
  try {
    const { accountNumber, bankCode, accountName, accountType, balanceKobo } = req.body;
    if (!accountNumber || !bankCode || !accountName) {
      return fail(res, 'accountNumber, bankCode and accountName are required', 'VAL_001');
    }
    const existing = await MockAccount.findOne({ accountNumber, bankCode });
    if (existing) return fail(res, 'Account already exists', 'DUPLICATE_001', 409);

    const account = await MockAccount.create({
      accountNumber,
      bankCode,
      bankName: BANK_NAMES[bankCode] || bankCode,
      accountName: accountName.toUpperCase().trim(),
      accountType: accountType || 'savings',
      balanceKobo: parseInt(balanceKobo) || 0,
    });
    return ok(res, account, 201);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// PATCH /api/accounts/:id/credit
app.patch('/api/accounts/:id/credit', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return fail(res, 'Valid amount required', 'VAL_001');
    const account = await MockAccount.findById(req.params.id);
    if (!account) return fail(res, 'Account not found', 'NOT_FOUND', 404);
    account.balanceKobo += parseInt(amount);
    await account.save();
    await MockTransaction.create({
      bankReference:    bankRef(account.bankCode),
      type:             'credit',
      accountNumber:    account.accountNumber,
      bankCode:         account.bankCode,
      amountKobo:       parseInt(amount),
      balanceAfterKobo: account.balanceKobo,
      narration:        'Manual credit from dashboard',
    });
    return ok(res, account);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// DELETE /api/accounts/:id
app.delete('/api/accounts/:id', async (req, res) => {
  try {
    await MockAccount.findByIdAndUpdate(req.params.id, { isActive: false });
    return ok(res, { deleted: true });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// GET /api/transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [txns, total] = await Promise.all([
      MockTransaction.find({}).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      MockTransaction.countDocuments(),
    ]);
    return ok(res, { transactions: txns, total });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// GET /api/otps
app.get('/api/otps', async (req, res) => {
  try {
    const otps = await MockOtp.find({}).sort({ createdAt: -1 }).limit(50).lean();
    return ok(res, otps);
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const [accounts, txns, activeOtps, totalBalance, banks] = await Promise.all([
      MockAccount.countDocuments({ isActive: true }),
      MockTransaction.countDocuments(),
      MockOtp.countDocuments({ used: false, expiresAt: { $gt: new Date() } }),
      MockAccount.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, total: { $sum: '$balanceKobo' } } }]),
      MockBank.countDocuments({ isActive: true }),
    ]);
    return ok(res, {
      accounts,
      transactions: txns,
      activeOtps,
      totalBalanceKobo: totalBalance[0]?.total ?? 0,
      banks,
    });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// POST /api/seed — seed test accounts AND banks
app.post('/api/seed', async (req, res) => {
  try {
    // Seed banks
    const bankSeeds = [
      { bankCode: '044', bankName: 'Access Bank',              shortName: 'Access',   nipCode: '044', ussdCode: '*901#' },
      { bankCode: '058', bankName: 'Guaranty Trust Bank',      shortName: 'GTBank',   nipCode: '058', ussdCode: '*737#' },
      { bankCode: '057', bankName: 'Zenith Bank',              shortName: 'Zenith',   nipCode: '057', ussdCode: '*966#' },
      { bankCode: '011', bankName: 'First Bank of Nigeria',    shortName: 'First Bank', nipCode: '011', ussdCode: '*894#' },
      { bankCode: '033', bankName: 'United Bank for Africa',   shortName: 'UBA',      nipCode: '033', ussdCode: '*919#' },
      { bankCode: '070', bankName: 'Fidelity Bank',            shortName: 'Fidelity', nipCode: '070', ussdCode: '*770#' },
      { bankCode: '214', bankName: 'First City Monument Bank', shortName: 'FCMB',     nipCode: '214', ussdCode: '*329#' },
      { bankCode: '232', bankName: 'Sterling Bank',            shortName: 'Sterling', nipCode: '232', ussdCode: '*822#' },
      { bankCode: '035', bankName: 'Wema Bank',                shortName: 'Wema',     nipCode: '035', ussdCode: '*945#' },
      { bankCode: '050', bankName: 'Ecobank Nigeria',          shortName: 'Ecobank',  nipCode: '050', ussdCode: '*326#' },
    ];

    let banksCreated = 0;
    for (const b of bankSeeds) {
      const exists = await MockBank.findOne({ bankCode: b.bankCode });
      if (!exists) { await MockBank.create(b); banksCreated++; }
    }

    // Seed accounts
    const accountSeeds = [
      { accountNumber: '0123456789', bankCode: '044', bankName: 'Access Bank',           accountName: 'SAMUEL OLOKOR',  accountType: 'savings', balanceKobo: 35_000_000 },
      { accountNumber: '9876543210', bankCode: '058', bankName: 'Guaranty Trust Bank',    accountName: 'JOHN ADEYEMI',   accountType: 'current', balanceKobo: 20_000_000 },
      { accountNumber: '1122334455', bankCode: '057', bankName: 'Zenith Bank',            accountName: 'AMAKA OKONKWO',  accountType: 'savings', balanceKobo: 50_000_000 },
      { accountNumber: '5544332211', bankCode: '044', bankName: 'Access Bank',            accountName: 'IBRAHIM MUSA',   accountType: 'current', balanceKobo:  7_500_000 },
      { accountNumber: '6677889900', bankCode: '058', bankName: 'Guaranty Trust Bank',    accountName: 'CHIDINMA EZE',   accountType: 'savings', balanceKobo: 120_000_000 },
    ];

    let accountsCreated = 0;
    for (const s of accountSeeds) {
      const exists = await MockAccount.findOne({ accountNumber: s.accountNumber, bankCode: s.bankCode });
      if (!exists) { await MockAccount.create(s); accountsCreated++; }
    }

    return ok(res, {
      seededBanks:    banksCreated,
      seededAccounts: accountsCreated,
      message: `${accountsCreated} accounts and ${banksCreated} banks created`,
    });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// DELETE /api/clear
app.delete('/api/clear', async (req, res) => {
  try {
    await Promise.all([
      MockAccount.deleteMany({}),
      MockOtp.deleteMany({}),
      MockTransaction.deleteMany({}),
      // Note: we do NOT clear banks on clear — they are configuration, not test data
    ]);
    return ok(res, { cleared: true });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// DELETE /api/clear-all — clears everything including banks (separate destructive action)
app.delete('/api/clear-all', async (req, res) => {
  try {
    await Promise.all([
      MockBank.deleteMany({}),
      MockAccount.deleteMany({}),
      MockOtp.deleteMany({}),
      MockTransaction.deleteMany({}),
    ]);
    return ok(res, { cleared: true });
  } catch (err) {
    return fail(res, err.message, 'INTERNAL_001', 500);
  }
});

// Serve UI for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏦  Ruby Mock Bank running on http://localhost:${PORT}`);
  console.log(`📊  Dashboard:    http://localhost:${PORT}`);
  console.log(`🔌  API base:     http://localhost:${PORT}/mock-bank`);
  console.log(`🔑  API key:      ${API_KEY}\n`);
  console.log('Endpoints:');
  console.log('  GET  /mock-bank/banks');
  console.log('  POST /mock-bank/validate-account');
  console.log('  POST /mock-bank/verify-otp');
  console.log('  GET  /mock-bank/account-details/:accountNumber');
  console.log('  POST /mock-bank/transfer');
  console.log('  GET  /mock-bank/transfer-status/:reference');
  console.log('  GET  /mock-bank/balance/:accountNumber');
  console.log('  POST /mock-bank/airtime');
  console.log('  POST /mock-bank/data');
  console.log('  POST /mock-bank/bill');
  console.log('  GET  /mock-bank/statement/:accountNumber\n');
});