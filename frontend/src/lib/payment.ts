// Bank-transfer payment details shown when a user needs to buy more credits
// (no payment gateway yet — manual transfer + the owner tops them up).
// Drop your bank QR image at public/bank-qr.png.
export const BANK_INFO = {
    bank: 'VPBank',
    accountNumber: '880010603',
    accountHolder: 'VO NAM HIEU',
    qrImage: '/bank-qr.png',
};

// One-time free grant on the first top-up request (matches backend
// CREDIT_FREE_TOPUP). Separate from the paid packs below.
export const FREE_TOPUP = 50;

// Paid top-up packs (VND → credits). Manual bank transfer; owner credits after.
export const TOPUP_PACKS = [
    { credits: 50, priceVnd: 50_000 },
    { credits: 120, priceVnd: 100_000 },
];

// Bank-transfer memo. The user's email is appended so transfers can be matched.
export const TRANSFER_NOTE = 'top-up tokens Copo';

export const SUPPORT_EMAIL = 'vonamhieu.work@gmail.com';
