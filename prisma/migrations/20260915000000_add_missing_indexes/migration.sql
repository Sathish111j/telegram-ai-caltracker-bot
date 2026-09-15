-- Indexes supporting getTodayFoods / softDeleteFoodItemById filtering on (food_log_id, is_deleted)
CREATE INDEX IF NOT EXISTS food_items_food_log_id_is_deleted_idx
  ON food_items (food_log_id, is_deleted);

-- Index supporting the meal-gap job's per-user (user_id, created_at) range scan
CREATE INDEX IF NOT EXISTS food_logs_user_id_created_at_idx
  ON food_logs (user_id, created_at);
