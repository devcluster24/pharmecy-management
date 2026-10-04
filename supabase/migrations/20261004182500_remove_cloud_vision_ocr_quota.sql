drop function if exists public.consume_cloud_vision_monthly_scan();
drop table if exists public.cloud_vision_ocr_monthly_usage;

notify pgrst, 'reload schema';
