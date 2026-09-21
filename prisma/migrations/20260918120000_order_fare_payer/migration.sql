-- Who pays the fare: sender or receiver (cash). Booker paying online still sets this to their role.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "farePayer" "CustomerRole" NOT NULL DEFAULT 'sender';
