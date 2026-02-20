"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import * as Tabs from "@radix-ui/react-tabs";
import { Loader2, Camera, ArrowUpRight, Trash2, Sparkles } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { getAvatarUrl } from "@/lib/file-utils";
import { validateFiles } from "@/lib/file-validation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { SaveBarProvider } from "@/contexts/SaveBarContext";

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, refetchUser } = useAuthContext();
  const authService = useAuth();
  const { success, error } = useNotifications();

  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [socialX, setSocialX] = useState("");
  const [socialLinkedin, setSocialLinkedin] = useState("");
  const [socialGithub, setSocialGithub] = useState("");
  const [websites, setWebsites] = useState<string[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState({
    connectionUpdates: true,
    weeklyNewsletter: true,
  });

  const [activeTab, setActiveTab] = useState<"settings" | "notifications">("settings");
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [generatingIntro, setGeneratingIntro] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push("/");
  }, [authLoading, isAuthenticated, router]);

  const resetForm = useCallback((u: typeof user) => {
    if (!u) return;
    setName(u.name || "");
    setIntro(u.intro || "");
    setLocation(u.location || "");
    setTimezone(u.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    setSocialX(u.socials?.x || "");
    setSocialLinkedin(u.socials?.linkedin || "");
    setSocialGithub(u.socials?.github || "");
    setWebsites(u.socials?.websites || []);
    setNotificationPreferences(
      u.notificationPreferences || { connectionUpdates: true, weeklyNewsletter: true }
    );
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError(null);
    setIsDirty(false);
  }, []);

  useEffect(() => {
    resetForm(user);
  }, [user, resetForm]);

  const mark = () => setIsDirty(true);

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateFiles([file], "avatar");
    if (!validation.isValid) {
      setAvatarError(validation.message || "Invalid file");
      e.target.value = "";
      return;
    }
    setAvatarError(null);
    setAvatarFile(file);
    setIsDirty(true);
    const reader = new FileReader();
    reader.onload = (evt) => setAvatarPreview(evt.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const addWebsite = () => {
    if (websites.length < 3) { setWebsites([...websites, ""]); mark(); }
  };
  const removeWebsite = (i: number) => { setWebsites(websites.filter((_, idx) => idx !== i)); mark(); };
  const updateWebsite = (i: number, val: string) => {
    const updated = [...websites]; updated[i] = val; setWebsites(updated); mark();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let avatarFilename = user?.avatar;
      if (avatarFile) avatarFilename = await authService.uploadAvatar(avatarFile);

      const socials = {
        ...(socialX && { x: socialX }),
        ...(socialLinkedin && { linkedin: socialLinkedin }),
        ...(socialGithub && { github: socialGithub }),
        ...(websites.length > 0 && { websites: websites.filter((w) => w) }),
      };

      await authService.updateProfile({
        name: name || undefined,
        intro: intro || undefined,
        location: location || undefined,
        avatar: avatarFilename || undefined,
        timezone: timezone || undefined,
        socials: Object.keys(socials).length > 0 ? socials : undefined,
        notificationPreferences,
      });

      await refetchUser();
      setAvatarFile(null);
      setAvatarPreview(null);
      setIsDirty(false);
      success("Profile saved");
    } catch {
      error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => resetForm(user);

  const handleGenerateIntro = async () => {
    setGeneratingIntro(true);
    try {
      const generated = await authService.generateIntro();
      if (generated) {
        setIntro(generated);
        mark();
      } else {
        error("Couldn't generate an intro — try adding your socials or a full name first.");
      }
    } catch {
      error("Failed to generate intro");
    } finally {
      setGeneratingIntro(false);
    }
  };

  if (authLoading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  const avatarSrc = avatarPreview || (user ? getAvatarUrl(user) : null);

  return (
    <SaveBarProvider visible={isDirty}>
      <ClientLayout>
        <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-8">Profile</h1>

          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <Tabs.List className="flex border-b border-gray-200 mb-8">
              <Tabs.Trigger
                value="settings"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                Settings
              </Tabs.Trigger>
              <Tabs.Trigger
                value="notifications"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                Notifications
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="settings">
          <div className="space-y-10">

            {/* Identity header */}
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative flex-shrink-0 group cursor-pointer"
              >
                <div className="w-[72px] h-[72px] rounded-full overflow-hidden bg-gray-100">
                  {avatarSrc ? (
                    <Image
                      src={avatarSrc}
                      alt={user?.name || "Avatar"}
                      width={72}
                      height={72}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Camera className="w-6 h-6" />
                    </div>
                  )}
                </div>
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-white" />
                </div>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />

              <div className="min-w-0">
                <div className="font-semibold text-gray-900 font-ibm-plex-mono truncate leading-tight">
                  {name || user?.name || "Your name"}
                </div>
                {user?.id && (
                  <Link
                    href={`/u/${user.id}`}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-black transition-colors duration-150 mt-1"
                  >
                    View public profile
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
            {avatarError && <p className="text-sm text-red-500 -mt-6">{avatarError}</p>}

            {/* Public Profile */}
            <div className="space-y-4 pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono pt-4">
                Public Profile
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="name" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Name <span className="text-gray-400">*</span>
                  </label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => { setName(e.target.value); mark(); }}
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="email" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Email
                  </label>
                  <Input
                    id="email"
                    value={user?.email || ''}
                    readOnly
                    className="bg-gray-50 text-gray-400 cursor-default"
                  />
                </div>
                <div>
                  <label htmlFor="location" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Location
                  </label>
                  <Input
                    id="location"
                    value={location}
                    onChange={(e) => { setLocation(e.target.value); mark(); }}
                    placeholder="Brooklyn, NY"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="intro" className="text-sm font-medium font-ibm-plex-mono text-gray-700">
                    Introduction
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateIntro}
                      disabled={generatingIntro}
                      title="Generate with AI"
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-black transition-colors duration-150 disabled:opacity-40"
                    >
                      {generatingIntro ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{generatingIntro ? "Generating..." : intro ? "Regenerate" : "Generate"}</span>
                    </button>
                    <span className="text-xs text-gray-400">{intro.length}/500</span>
                  </div>
                </div>
                <Textarea
                  id="intro"
                  value={intro}
                  onChange={(e) => { setIntro(e.target.value); mark(); }}
                  className="min-h-[80px] resize-none [field-sizing:content]"
                  placeholder="Tell others about yourself..."
                  maxLength={500}
                />
              </div>
            </div>

            {/* Socials */}
            <div className="space-y-2.5 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono pt-4 mb-4">
                Socials
              </p>

              {[
                { prefix: "x.com/", value: socialX, onChange: (v: string) => { setSocialX(v); mark(); } },
                { prefix: "linkedin.com/in/", value: socialLinkedin, onChange: (v: string) => { setSocialLinkedin(v); mark(); } },
                { prefix: "github.com/", value: socialGithub, onChange: (v: string) => { setSocialGithub(v); mark(); } },
              ].map(({ prefix, value, onChange }) => (
                <div key={prefix} className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
                  <span className="px-3 py-2 bg-gray-50 text-gray-400 font-ibm-plex-mono text-xs border-r border-gray-200 whitespace-nowrap select-none">
                    {prefix}
                  </span>
                  <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
                  />
                </div>
              ))}

              {websites.map((website, i) => (
                <div key={i} className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
                  <Input
                    value={website}
                    onChange={(e) => updateWebsite(i, e.target.value)}
                    placeholder="https://example.com"
                    className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeWebsite(i)}
                    className="px-3 py-2 text-gray-400 hover:text-red-500 transition-colors border-l border-gray-200"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {websites.length < 3 && (
                <button
                  type="button"
                  onClick={addWebsite}
                  className="w-full flex items-center justify-center px-3 py-2 border border-dashed border-gray-200 rounded-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors duration-150 text-sm"
                >
                  + Add website
                </button>
              )}
            </div>

          </div>
            </Tabs.Content>

            <Tabs.Content value="notifications">
              <div className="space-y-6">
                {/* Timezone */}
                <div>
                  <label htmlFor="timezone" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Timezone
                  </label>
                  <div className="relative">
                    <select
                      id="timezone"
                      value={timezone}
                      onChange={(e) => { setTimezone(e.target.value); mark(); }}
                      className="flex h-10 w-full rounded-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 hover:border-gray-400 focus:border-gray-900 focus:outline-none focus:ring-0 appearance-none cursor-pointer"
                    >
                      {Intl.supportedValuesOf("timeZone").map((tz) => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Email notifications */}
                <div className="space-y-2.5 border-t border-gray-100 pt-6">
                  <p className="text-sm text-gray-600 mb-4">
                    Choose which emails you'd like to receive.
                  </p>
                {[
                  {
                    key: "connectionUpdates" as const,
                    label: "Connection Updates",
                    description: "Email when someone connects with you",
                  },
                  {
                    key: "weeklyNewsletter" as const,
                    label: "Weekly Newsletter",
                    description: "Weekly summary of new connections",
                  },
                ].map(({ key, label, description }) => (
                  <label
                    key={key}
                    className="flex items-center justify-between p-3 border border-gray-200 rounded-sm cursor-pointer hover:bg-gray-50 transition-colors duration-150"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{description}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notificationPreferences[key]}
                      onChange={(e) => {
                        setNotificationPreferences((prev) => ({ ...prev, [key]: e.target.checked }));
                        mark();
                      }}
                      className="w-4 h-4 accent-black"
                    />
                  </label>
                ))}
                </div>
              </div>
            </Tabs.Content>
          </Tabs.Root>

        </ContentContainer>
      </div>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-white border-t border-gray-200 z-40 px-6 lg:px-8">
          <div className="max-w-3xl mx-auto py-3 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <span className="text-sm text-gray-500">You have unsaved changes</span>
            <div className="flex items-center gap-2 justify-self-end">
              <Button variant="outline" onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>
              <Button onClick={handleSave} disabled={saving || !!avatarError}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
      </ClientLayout>
    </SaveBarProvider>
  );
}
