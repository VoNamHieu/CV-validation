// Bank-transfer payment details shown when a user needs to buy more credits
// (no payment gateway yet — manual transfer + the owner tops them up).
//
// TODO(owner): edit these and drop your bank QR image at public/bank-qr.png.
// Transfer note should be the user's email so top-ups can be matched.
export const BANK_INFO = {
    bank: 'Vietcombank',
    accountNumber: '0000000000',
    accountHolder: 'VO NAM HIEU',
    qrImage: '/bank-qr.png',   // place your QR/bank image here (public/bank-qr.png)
};

// Credits per paid top-up pack + its price (VND). Adjust to your pricing.
export const TOPUP_PACK = { credits: 50, priceVnd: 50000 };

export const SUPPORT_EMAIL = 'vonamhieu.work@gmail.com';
