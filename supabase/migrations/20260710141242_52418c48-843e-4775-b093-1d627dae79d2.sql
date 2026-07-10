
CREATE TABLE IF NOT EXISTS public.ui_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  section_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  element_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ui_preferences TO authenticated;
GRANT ALL ON public.ui_preferences TO service_role;

ALTER TABLE public.ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own ui prefs"
  ON public.ui_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
