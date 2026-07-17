-- Supabase Database Schema

create table quizzes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  pdf_name text not null,
  language text not null,
  num_questions integer not null,
  questions jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table quizzes enable row level security;

create policy "Users can view their own quizzes" 
  on quizzes for select 
  using (auth.uid() = user_id);

create policy "Users can insert their own quizzes" 
  on quizzes for insert 
  with check (auth.uid() = user_id);

create policy "Users can update their own quizzes" 
  on quizzes for update 
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own quizzes" 
  on quizzes for delete 
  using (auth.uid() = user_id);

create table mock_attempts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  pdf_name text not null,
  score integer not null,
  correct_count integer not null,
  total_questions integer not null,
  time_seconds integer not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table mock_attempts enable row level security;

create policy "Users can view their own attempts" 
  on mock_attempts for select 
  using (auth.uid() = user_id);

create policy "Users can insert their own attempts" 
  on mock_attempts for insert 
  with check (auth.uid() = user_id);

create policy "Users can delete their own attempts" 
  on mock_attempts for delete 
  using (auth.uid() = user_id);

create index quizzes_user_id_idx on quizzes(user_id);
create index quizzes_created_at_idx on quizzes(created_at desc);

create index mock_attempts_user_id_idx on mock_attempts(user_id);
create index mock_attempts_created_at_idx on mock_attempts(created_at desc);
