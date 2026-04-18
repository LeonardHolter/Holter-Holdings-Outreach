-- Remove A1 Garage Door Service and all Precision Garage Door of xxx from the pipeline
-- Run this in the Supabase SQL Editor

DELETE FROM companies WHERE company_name = 'A1 Garage Door Service';
DELETE FROM companies WHERE company_name LIKE 'Precision Garage Door of %';
