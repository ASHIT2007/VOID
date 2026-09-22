"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import CosmicBackground from "@/components/CosmicBackground";
import { Lock, ArrowRight, CheckCircle2 } from "lucide-react";

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Check if the user is actually logged in (which happens automatically via the magic link)
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Invalid or expired password reset link. Please try again from the login page.");
      }
    };
    checkSession();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (password !== confirmPassword) {
      setError("Passwords do not match!");
      return;
    }
    
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    
    const { error } = await supabase.auth.updateUser({ password });
    
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    }
    
    setLoading(false);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-black text-gray-900 dark:text-white font-sans relative overflow-hidden">
      <CosmicBackground />
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />
      
      <div className="z-10 w-full max-w-md p-8 sm:p-10 bg-white/70 dark:bg-[#2A2A2A]/70 backdrop-blur-2xl rounded-3xl border border-white/20 dark:border-white/5 shadow-2xl flex flex-col items-center">
        
        <div className="mb-8 relative w-24 h-24 rounded-full flex items-center justify-center bg-white dark:bg-[#1A1A1A] border-4 border-white dark:border-[#3A3A3A] shadow-xl overflow-hidden">
          <div className="w-full h-full p-3 flex items-center justify-center">
            <img src="/void logo.png" alt="App Logo" className="w-full h-full object-contain dark:hidden" />
            <img src="/void logo white.png" alt="App Logo" className="w-full h-full object-contain hidden dark:block" />
          </div>
        </div>

        <h2 className="text-2xl sm:text-3xl font-semibold mb-2 text-center tracking-tight">
          Update Password
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-8 text-center">
          Securely enter your new password below.
        </p>
        
        {error && (
          <div className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 p-3 rounded-xl mb-6 text-sm text-center">
            {error}
          </div>
        )}
        
        {success ? (
          <div className="w-full flex flex-col items-center justify-center p-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
            <p className="text-emerald-700 dark:text-emerald-400 font-medium text-center">
              Password updated securely!
            </p>
            <p className="text-emerald-600 dark:text-emerald-500 text-sm text-center mt-2">
              Redirecting to your workspace...
            </p>
          </div>
        ) : (
          <form onSubmit={handleUpdate} className="w-full space-y-5">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
              </div>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New Password"
                className="w-full bg-gray-50/50 dark:bg-[#1A1A1A]/50 text-gray-900 dark:text-white rounded-xl pl-11 pr-4 py-3.5 border border-gray-200 dark:border-[#3A3A3A] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400"
                required
              />
            </div>
            
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
              </div>
              <input 
                type="password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm New Password"
                className="w-full bg-gray-50/50 dark:bg-[#1A1A1A]/50 text-gray-900 dark:text-white rounded-xl pl-11 pr-4 py-3.5 border border-gray-200 dark:border-[#3A3A3A] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400"
                required
              />
            </div>

            <button 
              type="submit" 
              disabled={loading || !!error?.includes("expired")}
              className="group w-full flex items-center justify-center gap-2 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black py-3.5 rounded-xl font-medium transition-all disabled:opacity-70 disabled:cursor-not-allowed mt-2 active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 dark:border-black/30 border-t-white dark:border-t-black animate-spin" />
                  Updating...
                </span>
              ) : (
                <>
                  Update Password
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
