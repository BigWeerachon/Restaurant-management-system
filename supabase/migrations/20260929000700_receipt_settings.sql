-- Receipt settings (V1.1, 7.1)
--   tenants.legal_name / tenants.tax_id and branches.tax_branch_no come with the original schema; this adds the one
--   thing a printed receipt still needs: a line at the bottom (thanks, the Wi-Fi password, a promotion).
alter table app.tenants
  add column receipt_footer text check (receipt_footer is null or length(receipt_footer) <= 200);
