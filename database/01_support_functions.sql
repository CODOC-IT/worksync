-- PostgreSQL equivalents for SQL Server JSON validation and row-version behavior.

CREATE FUNCTION config.is_valid_json(input_text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
    PERFORM input_text::jsonb;
    RETURN TRUE;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN FALSE;
END;
$$;

CREATE FUNCTION config.bump_row_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.RowVersion := OLD.RowVersion + 1;
    RETURN NEW;
END;
$$;
