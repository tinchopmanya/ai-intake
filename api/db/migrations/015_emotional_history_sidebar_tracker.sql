ALTER TABLE emotional_checkins
ADD COLUMN IF NOT EXISTS vinculo_expareja integer NULL,
ADD COLUMN IF NOT EXISTS interaccion_hijos integer NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'emotional_checkins_vinculo_expareja_check'
    ) THEN
        ALTER TABLE emotional_checkins
        ADD CONSTRAINT emotional_checkins_vinculo_expareja_check
        CHECK (vinculo_expareja IS NULL OR vinculo_expareja BETWEEN 1 AND 5);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'emotional_checkins_interaccion_hijos_check'
    ) THEN
        ALTER TABLE emotional_checkins
        ADD CONSTRAINT emotional_checkins_interaccion_hijos_check
        CHECK (interaccion_hijos IS NULL OR interaccion_hijos BETWEEN 1 AND 5);
    END IF;
END $$;
