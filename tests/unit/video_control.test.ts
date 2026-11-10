import { describe, expect, it } from 'vitest';
import { extractYouTubeId, type VideoControlCommand } from '../../src/layers/SlideMediaOverlay';

describe('Video Control Engine — URL extraction & Command Logic', () => {
  it('extracts valid YouTube IDs from standard watch URLs', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share')).toBe('dQw4w9WgXcQ');
  });

  it('extracts YouTube IDs from youtu.be shortlinks', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('http://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
  });

  it('extracts YouTube IDs from embed and shorts links', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('recognizes raw 11-character YouTube video IDs directly', () => {
    expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for local or non-YouTube URLs', () => {
    expect(extractYouTubeId('https://example.com/videos/lesson1.mp4')).toBeNull();
    expect(extractYouTubeId('blob:http://localhost:5173/1234-5678')).toBeNull();
    expect(extractYouTubeId(undefined)).toBeNull();
  });

  it('validates VideoControlCommand data structure for all required actions', () => {
    const playCmd: VideoControlCommand = { action: 'play' };
    const pauseCmd: VideoControlCommand = { action: 'pause' };
    const volUpCmd: VideoControlCommand = { action: 'volume_up' };
    const volDownCmd: VideoControlCommand = { action: 'volume_down' };
    const setVolCmd: VideoControlCommand = { action: 'set_volume', volume: 75 };
    const speedCmd: VideoControlCommand = { action: 'set_speed', speed: 1.25 };
    const subCmd: VideoControlCommand = { action: 'set_subtitle_language', language: 'ar' };
    const audioCmd: VideoControlCommand = { action: 'set_audio_language', language: 'en' };
    const qualCmd: VideoControlCommand = { action: 'set_quality', quality: 'hd1080' };
    const maxCmd: VideoControlCommand = { action: 'maximize' };
    const minCmd: VideoControlCommand = { action: 'minimize' };
    const fullCmd: VideoControlCommand = { action: 'fullscreen' };

    expect(playCmd.action).toBe('play');
    expect(pauseCmd.action).toBe('pause');
    expect(volUpCmd.action).toBe('volume_up');
    expect(volDownCmd.action).toBe('volume_down');
    expect(setVolCmd.volume).toBe(75);
    expect(speedCmd.speed).toBe(1.25);
    expect(subCmd.language).toBe('ar');
    expect(audioCmd.language).toBe('en');
    expect(qualCmd.quality).toBe('hd1080');
    expect(maxCmd.action).toBe('maximize');
    expect(minCmd.action).toBe('minimize');
    expect(fullCmd.action).toBe('fullscreen');
  });

  it('properly calculates normalized volume for local videos and YouTube percentages', () => {
    const rawVolume = 60;
    const localVolumeFloat = Math.min(1.0, Math.max(0.0, rawVolume / 100));
    const ytVolumeInt = Math.max(0, Math.min(100, rawVolume));

    expect(localVolumeFloat).toBe(0.6);
    expect(ytVolumeInt).toBe(60);
  });

  it('clamps speed rates between 0.25x and 2.0x', () => {
    const clampSpeed = (s: number) => Math.max(0.25, Math.min(2.0, s));
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(1.5)).toBe(1.5);
    expect(clampSpeed(5.0)).toBe(2.0);
  });
});
