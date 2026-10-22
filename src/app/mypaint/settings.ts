/* Ported from libmypaint (https://github.com/mypaint/libmypaint, commit d5a88fb), brushsettings.json.
 * libmypaint - The MyPaint Brush Library
 * Copyright (C) 2007-2011 Martin Renold <martinxyz@gmx.ch> and contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// Brush inputs (dynamics sources), in libmypaint order
export const INPUTS = ["pressure", "random", "stroke", "direction", "tilt_declination", "tilt_ascension", "speed1", "speed2", "custom", "direction_angle", "attack_angle", "tilt_declinationx", "tilt_declinationy", "gridmap_x", "gridmap_y", "viewzoom", "brush_radius", "barrel_rotation"] as const;
export type InputName = typeof INPUTS[number];
/** Old .myb files use pre-rename input names */
export const INPUT_ALIASES: Record<string, InputName> = { surfacemap_x: 'gridmap_x', surfacemap_y: 'gridmap_y' };

// Brush settings with their libmypaint defaults
export const SETTING_DEFAULTS = {
  opaque: 1.0,
  opaque_multiply: 0.0,
  opaque_linearize: 0.9,
  radius_logarithmic: 2.0,
  hardness: 0.8,
  softness: 0.0,
  anti_aliasing: 1.0,
  dabs_per_basic_radius: 0.0,
  dabs_per_actual_radius: 2.0,
  dabs_per_second: 0.0,
  gridmap_scale: 0.0,
  gridmap_scale_x: 1.0,
  gridmap_scale_y: 1.0,
  radius_by_random: 0.0,
  speed1_slowness: 0.04,
  speed2_slowness: 0.8,
  speed1_gamma: 4.0,
  speed2_gamma: 4.0,
  offset_by_random: 0.0,
  offset_y: 0.0,
  offset_x: 0.0,
  offset_angle: 0.0,
  offset_angle_asc: 0.0,
  offset_angle_view: 0.0,
  offset_angle_2: 0.0,
  offset_angle_2_asc: 0.0,
  offset_angle_2_view: 0.0,
  offset_angle_adj: 0.0,
  offset_multiplier: 0.0,
  offset_by_speed: 0.0,
  offset_by_speed_slowness: 1.0,
  slow_tracking: 0.0,
  slow_tracking_per_dab: 0.0,
  tracking_noise: 0.0,
  color_h: 0.0,
  color_s: 0.0,
  color_v: 0.0,
  restore_color: 0.0,
  change_color_h: 0.0,
  change_color_l: 0.0,
  change_color_hsl_s: 0.0,
  change_color_v: 0.0,
  change_color_hsv_s: 0.0,
  smudge: 0.0,
  paint_mode: 1.0,
  smudge_transparency: 0.0,
  smudge_length: 0.5,
  smudge_length_log: 0.0,
  smudge_bucket: 0.0,
  smudge_radius_log: 0.0,
  eraser: 0.0,
  stroke_threshold: 0.0,
  stroke_duration_logarithmic: 4.0,
  stroke_holdtime: 0.0,
  custom_input: 0.0,
  custom_input_slowness: 0.0,
  elliptical_dab_ratio: 1.0,
  elliptical_dab_angle: 90.0,
  direction_filter: 2.0,
  lock_alpha: 0.0,
  colorize: 0.0,
  posterize: 0.0,
  posterize_num: 0.05,
  snap_to_pixel: 0.0,
  pressure_gain_log: 0.0,
} as const;
export type SettingName = keyof typeof SETTING_DEFAULTS;
export const SETTINGS = Object.keys(SETTING_DEFAULTS) as SettingName[];
