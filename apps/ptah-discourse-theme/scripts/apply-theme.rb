# =============================================================================
# Ptah Community — dev-only rails runner apply script
# =============================================================================
# Best-effort programmatic alternative to the Admin UI import, for the local
# `discourse_dev` container (see ../README.md "Dev apply"). Reads the sibling
# theme files off disk (already `docker cp`'d into the container) and wires up
# a Theme + ColorScheme using Discourse's `Theme#set_field` / `ColorScheme`
# APIs directly — no git remote required.
#
# ASSUMPTION (flagged in discourse-theme.md): `Theme#set_field(target:, name:,
# value:)`, `ColorScheme` + its `color_scheme_colors` association (name/hex),
# and `Theme#set_default!` are stable public APIs used internally by Discourse
# core/specs at the time this was written, but are NOT part of a documented
# external plugin API and can drift between Discourse versions. If this script
# errors, fall back to the manual Admin UI import in ../README.md (the
# guaranteed-to-work path) — the about.json/common.scss files are unaffected
# either way.
#
# Usage (from the HOST machine):
#   docker cp "discourse-theme" discourse_dev:/tmp/ptah-theme
#   docker exec -u discourse:discourse discourse_dev bash -lc \
#     "cd /src && bin/rails runner /tmp/ptah-theme/scripts/apply-theme.rb"
# =============================================================================

require "json"
require "fileutils"
require "tmpdir"

base = "/tmp/ptah-theme"
about = JSON.parse(File.read(File.join(base, "about.json")))

scheme_name = about.fetch("color_schemes").keys.first
colors = about["color_schemes"][scheme_name]

# -- 1. Color scheme ----------------------------------------------------------
scheme = ColorScheme.find_by(name: scheme_name) || ColorScheme.new(name: scheme_name)
scheme.save! if scheme.new_record?

colors.each do |key, hex|
  row = scheme.color_scheme_colors.find_by(name: key) ||
    scheme.color_scheme_colors.build(name: key)
  row.hex = hex
  row.save!
end
scheme.save!

# -- 2. Theme + fields ---------------------------------------------------------
theme_name = about.fetch("name")
theme = Theme.find_by(name: theme_name) ||
  Theme.new(name: theme_name, user_id: Discourse.system_user.id)
theme.color_scheme_id = scheme.id
theme.save!

theme.set_field(target: :common, name: "scss", value: File.read(File.join(base, "common/common.scss")))
theme.set_field(target: :common, name: "header", value: File.read(File.join(base, "common/header.html")))
theme.set_field(target: :translations, name: "en", value: File.read(File.join(base, "locales/en.yml")))
theme.save!

theme.set_default!

# -- 3. Site logo (global SiteSetting — NOT theme-scoped) ----------------------
# The site header wordmark is `SiteSetting.logo`, which a theme import does not
# set. Apply it here from the theme's `assets.ptah-logo` so one command wires up
# theme + colors + logo reproducibly (dev and prod). UploadCreator sanitizes the
# SVG by writing back to the source file, so copy it to a writable temp first
# (the theme dir is commonly owned by root / read-only for the `discourse` user).
# Non-fatal: on any failure, fall back to the manual Admin > Settings > Logo step.
logo_rel = about.dig("assets", "ptah-logo")
if logo_rel
  tmp = File.join(Dir.tmpdir, "ptah-logo-#{Process.pid}.svg")
  begin
    FileUtils.cp(File.join(base, logo_rel), tmp)
    File.chmod(0644, tmp)
    upload = UploadCreator
      .new(File.open(tmp), File.basename(logo_rel), type: "site_setting")
      .create_for(Discourse.system_user.id)
    if upload&.persisted?
      SiteSetting.logo = upload
      SiteSetting.logo_small = upload
      SiteSetting.mobile_logo = upload
      puts "Set site logo from #{logo_rel} (upload ##{upload.id})"
    else
      puts "WARN: logo upload failed (#{upload&.errors&.full_messages&.inspect}) — set it manually in Admin > Settings > Logo"
    end
  rescue => e
    puts "WARN: could not set site logo (#{e.class}: #{e.message}) — set it manually in Admin > Settings > Logo"
  ensure
    File.delete(tmp) if File.exist?(tmp)
  end
end

puts "Applied theme ##{theme.id} (#{theme.name}) with color scheme ##{scheme.id} (#{scheme.name})"
puts "Restart the rails server or hard-refresh the forum to see it."
