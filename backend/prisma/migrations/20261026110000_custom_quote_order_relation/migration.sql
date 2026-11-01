-- Link accepted custom-print requests to their payable order without deleting historical quotes.
ALTER TABLE "CustomPrintRequest"
  ADD CONSTRAINT "CustomPrintRequest_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
