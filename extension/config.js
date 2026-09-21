/* JobFlow AI - public runtime config.
 * These values are safe to ship: the anon key is public and protected by Row Level Security.
 * NEVER put the OpenRouter key or the Supabase service-role key here.
 * `npm run build:ext` rewrites this file from .env for production builds. */
self.JOBFLOW_CONFIG = {
  supabaseUrl: 'https://ztthkncbktcndgypyazn.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0dGhrbmNia3RjbmRneXB5YXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTQwNDcsImV4cCI6MjEwNTEzMDA0N30.9cirrxmLm0gYEdYR90OxyXIOcn-zZSGjRq0wTuVnPVo',
  webAppUrl: 'https://app.jobflow.ai',
  supportEmail: 'support@jobflow.ai'
};
