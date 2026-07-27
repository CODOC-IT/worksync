import { createClient, RealtimeChannel } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export function subscribeToChannel(
  channelName: string,
  onBroadcast: (payload: any) => void,
  onPresence?: (payload: any) => void
): RealtimeChannel | null {
  if (!supabase) return null;

  const channel = supabase.channel(channelName);

  channel.on('broadcast', { event: 'notification' }, (payload) => {
    onBroadcast(payload.payload);
  });

  if (onPresence) {
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      onPresence(state);
    });
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[Supabase] Connected to channel: ${channelName}`);
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      console.warn(`[Supabase] Channel ${channelName} status: ${status}`);
    }
  });

  return channel;
}

export function unsubscribeFromChannel(channel: RealtimeChannel | null): void {
  if (!channel) return;
  supabase?.removeChannel(channel);
}
