const mongoose = require('mongoose');

// ── Mock Bank List ────────────────────────────────────────────────────────────
const bankSchema = new mongoose.Schema({
  bankCode: { type: String, required: true, unique: true, trim: true },
  bankName: { type: String, required: true, trim: true },
  shortName: { type: String,  trim: true },
  nipCode: { type: String,  trim: true },// NIPS/NIPS interbank code
  ussdCode: { type: String,  trim: true },// USSD code for mobile banking e.g *894#
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'mockbank_banks',
});

// ── Mock Bank Account ────────────────────────────────────────────────────────
const accountSchema = new mongoose.Schema({
  accountNumber: { type: String, required: true, trim: true },
  bankCode:      { type: String, required: true, trim: true },
  bankName:      { type: String, required: true },
  accountName:   { type: String, required: true, trim: true, uppercase: true },
  accountType:   { type: String, enum: ['savings', 'current'], default: 'savings' },
  balanceKobo:   { type: Number, default: 0, min: 0 },
  //simulated account details field 
    bvnMask:       { type: String, default: '2234****890' },
    tier:          { type: String, enum: ['tier1', 'tier2', 'tier3'], default: 'tier3' },
    email:         { type: String, default: '' },
    phone:         { type: String, default: '070****5678' },
    kycStatus:     { type: String, enum: ['verified', 'pending', 'failed'], default: 'verified' },
    isActive:      { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'mockbank_accounts',
});

accountSchema.index({ accountNumber: 1, bankCode: 1 }, { unique: true });

// ── OTP Record ────────────────────────────────────────────────────────────────
const otpSchema = new mongoose.Schema({
  reference:     { type: String, required: true, unique: true },
  accountNumber: { type: String, required: true },
  bankCode:      { type: String, required: true },
  code:          { type: String, required: true },
  expiresAt:     { type: Date, required: true },
  used:          { type: Boolean, default: false },
  usedAt:        { type: Date },
}, {
  timestamps: true,
  collection: 'mockbank_otps',
});

// ── Transaction Ledger ────────────────────────────────────────────────────────
const transactionSchema = new mongoose.Schema({
  bankReference:  { type: String, required: true, unique: true },
  rubyReference:  { type: String },
  type:           { type: String, enum: ['debit', 'credit', 'airtime', 'bill', 'data'], required: true },
  accountNumber:  { type: String, required: true },
  bankCode:       { type: String, required: true },
  amountKobo:     { type: Number, required: true },
  balanceAfterKobo: { type: Number, required: true },
  narration:      { type: String, default: '' },
  counterpartyAccount: { type: String },
  counterpartyBank:    { type: String },
  //Data-specific
  dataBundle:    { type: String }, //e.g. "1GB", "500MB"
  dataPlan:     { type: String }, //e.g. "Daily, "Monthly"
  //Bill-specific
  billerCode:    { type: String }, //e.g. "DSTV", "GOTV"
  billerCategory:{ type: String }, //e.g. "Cable TV", "Electricity"
  customerReference:{ type: String }, //e.g. "INV123456", "BILL789012"
    // Airtime / Data
  phoneNumber:      { type: String },
  network:          { type: String },
  responseCode:     { type: String, default: '00' },
  status:         { type: String, enum: ['success', 'failed', 'pending'], default: 'success' },
}, {
  timestamps: true,
  collection: 'mockbank_transactions',
});

const MockBank        = mongoose.model('MockBank',        bankSchema);
const MockAccount     = mongoose.model('MockAccount',     accountSchema);
const MockOtp         = mongoose.model('MockOtp',         otpSchema);
const MockTransaction = mongoose.model('MockTransaction', transactionSchema);

module.exports = { MockAccount, MockOtp, MockTransaction, MockBank };
