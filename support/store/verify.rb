# Read-only comparison of the local listing files with the draft held by each store.
# Loaded by the shared Fastfile (`rds store verify`). Nothing here uploads, edits or submits: Google
# Play edits are always aborted, and App Store Connect is only queried.
require 'digest'

module RdsStoreVerify
  PLAY_TEXT = %w[title short_description full_description video].freeze
  PLAY_IMAGE_EXTENSIONS = %w[.png .jpg .jpeg].freeze
  APPLE_VERSION_TEXT = {
    'description' => :description, 'keywords' => :keywords, 'promotional_text' => :promotional_text,
    'release_notes' => :whats_new, 'support_url' => :support_url, 'marketing_url' => :marketing_url
  }.freeze
  APPLE_INFO_TEXT = { 'name' => :name, 'subtitle' => :subtitle, 'privacy_url' => :privacy_policy_url }.freeze
  APPLE_IMAGE_EXTENSIONS = %w[.png .jpg .jpeg].freeze
  APPLE_VIDEO_EXTENSIONS = %w[.mp4 .mov .m4v].freeze
  # Folders under metadata/ios and screenshots/ that are not locales.
  APPLE_NON_LOCALES = %w[review_information default].freeze

  # Collects what was compared and what differs, then prints one summary per store.
  class Report
    attr_reader :problems

    def initialize
      @checked = Hash.new(0)
      @matched = Hash.new(0)
      @problems = []
      @pending = []
      @info = []
    end

    def compare(group, label, same, detail = 'differs from the store')
      @checked[group] += 1
      if same then @matched[group] += 1 else @problems << "#{label}: #{detail}" end
    end

    def problem(label, detail)
      @problems << "#{label}: #{detail}"
    end

    # Non-failing line (for example a release that is not in the store yet).
    def info(line)
      @info << line
    end

    def processing(label, state)
      @pending << "#{label}: #{state}"
    end

    def finish(store_name)
      puts "\n#{store_name}"
      @checked.each { |group, count| puts "  #{group}: #{@matched[group]}/#{count} match" }
      puts "  nothing compared (no local files for this scope)" if @checked.empty? && @problems.empty? && @info.empty?
      @pending.each { |line| puts "  still processing: #{line}" }
      @info.each { |line| puts "  #{line}" }
      unless @problems.empty?
        puts "  #{@problems.length} difference(s):"
        @problems.each { |line| puts "    - #{line}" }
      end
      @problems.empty?
    end
  end

  def self.text(path)
    File.read(path, encoding: 'UTF-8').sub(/\A﻿/, '').gsub("\r\n", "\n").strip
  end

  def self.remote_text(value)
    value.to_s.gsub("\r\n", "\n").strip
  end

  def self.locale_dirs(path, skip = [])
    return [] unless File.directory?(path)
    Dir.children(path).select { |n| File.directory?(File.join(path, n)) && !skip.include?(n) }.sort
  end

  def self.files(dir, extensions)
    return [] unless File.directory?(dir)
    Dir.children(dir).select { |n| File.file?(File.join(dir, n)) && extensions.include?(File.extname(n).downcase) }.sort.map { |n| File.join(dir, n) }
  end

  # Release notes (changelogs/<versionCode>.txt) against every track release that contains that version code.
  # Only languages with a non-empty local file are compared. A version code that is on no track yet is reported, not failed.
  def self.android_notes(client, metadata, version_code, report)
    local = {}
    locale_dirs(metadata).each do |locale|
      path = File.join(metadata, locale, 'changelogs', "#{version_code}.txt")
      local[locale] = text(path) if File.exist?(path) && !text(path).empty?
    end
    return if local.empty?
    releases = client.tracks.flat_map do |track|
      (track.releases || []).select { |release| (release.version_codes || []).map(&:to_s).include?(version_code.to_s) }.map { |release| [track.track, release] }
    end
    if releases.empty?
      report.info("release notes: versionCode #{version_code} is not on any Play track yet, nothing to compare")
      return
    end
    releases.each do |track, release|
      remote = (release.release_notes || []).to_h { |note| [note.language, note.text] }
      local.each do |locale, content|
        label = "android/#{locale}/changelogs/#{version_code} (#{track})"
        if remote[locale].nil? then report.compare('release notes', label, false, 'language missing in the release')
        else report.compare('release notes', label, content == remote_text(remote[locale])) end
      end
    end
  end

  # Google Play: listing text per language, release notes of one version code and every graphic (by SHA-256, in upload order).
  def self.android(key:, scope:, root:, version_code: nil)
    metadata = File.join(root, 'fastlane/metadata/android')
    report = Report.new
    client = Supply::Client.make_from_config(params: { json_key: File.expand_path(key), timeout: 120 })
    client.begin_edit(package_name: ENV.fetch('SUPPLY_PACKAGE_NAME'))
    begin
      android_notes(client, metadata, version_code, report) if %w[text all].include?(scope) && version_code && !version_code.to_s.empty?
      listings = client.listings.to_h { |l| [l.language, l] }
      locale_dirs(metadata).each do |locale|
        if %w[text all].include?(scope)
          listing = listings[locale]
          PLAY_TEXT.each do |field|
            path = File.join(metadata, locale, "#{field}.txt")
            next unless File.exist?(path) && !text(path).empty?
            label = "android/#{locale}/#{field}"
            if listing.nil? then report.compare('text', label, false, 'language missing in the store')
            else report.compare('text', label, text(path) == remote_text(listing.public_send(field))) end
          end
        end
        next unless %w[media all].include?(scope)
        images = File.join(metadata, locale, 'images')
        next unless File.directory?(images)
        Dir.children(images).sort.each do |name|
          path = File.join(images, name)
          type, local = if File.directory?(path) then [name, files(path, PLAY_IMAGE_EXTENSIONS)]
                        elsif PLAY_IMAGE_EXTENSIONS.include?(File.extname(name).downcase) then [File.basename(name, '.*'), [path]]
                        end
          next if type.nil? || local.empty?
          remote = client.fetch_images(image_type: type, language: locale).map(&:sha256)
          local.each_with_index do |file, i|
            report.compare('images', "android/#{locale}/#{type}/#{File.basename(file)}", remote[i] == Digest::SHA256.file(file).hexdigest)
          end
          report.problem("android/#{locale}/#{type}", "#{remote.length} in the store, #{local.length} local") unless remote.length == local.length
        end
      end
    ensure
      client.abort_current_edit
    end
    report.finish('Google Play (draft listing)')
  end

  # App Store Connect: the editable version's localized text, app-info text, screenshots and
  # previews (by MD5). Run Spaceship::ConnectAPI.token = ... before calling.
  def self.ios(bundle_id:, scope:, root:)
    metadata = File.join(root, 'fastlane/metadata/ios')
    report = Report.new
    app = Spaceship::ConnectAPI::App.find(bundle_id)
    FastlaneCore::UI.user_error!("No app with bundle ID #{bundle_id} in this App Store Connect team") unless app
    version = app.get_edit_app_store_version
    FastlaneCore::UI.user_error!('No editable App Store version: create one in App Store Connect first') unless version
    localizations = version.get_app_store_version_localizations.to_h { |l| [l.locale, l] }

    # Like deliver, skip What's New on the app's first version: App Store Connect does not hold it.
    first_version = Spaceship::ConnectAPI.get_app_store_versions(app_id: app.id, filter: { platform: 'IOS' }, limit: 2).count == 1

    if %w[text all].include?(scope)
      info = app.fetch_edit_app_info
      info_localizations = (info ? info.get_app_info_localizations : []).to_h { |l| [l.locale, l] }
      locale_dirs(metadata, APPLE_NON_LOCALES).each do |locale|
        { 'text' => [APPLE_VERSION_TEXT, localizations[locale]], 'app info' => [APPLE_INFO_TEXT, info_localizations[locale]] }.each do |group, (fields, remote)|
          fields.each do |file, attribute|
            next if first_version && file == 'release_notes'
            path = File.join(metadata, locale, "#{file}.txt")
            next unless File.exist?(path) && !text(path).empty?
            label = "ios/#{locale}/#{file}"
            if remote.nil? then report.compare(group, label, false, 'locale missing in the store')
            else report.compare(group, label, text(path) == remote_text(remote.public_send(attribute))) end
          end
        end
      end
    end

    if %w[media all].include?(scope)
      media = { 'screenshots' => [File.join(root, 'fastlane/screenshots'), APPLE_IMAGE_EXTENSIONS, ->(l) { l.get_app_screenshot_sets.flat_map(&:app_screenshots) }],
                'previews' => [File.join(root, 'fastlane/previews'), APPLE_VIDEO_EXTENSIONS, ->(l) { l.get_app_preview_sets.flat_map(&:app_previews) }] }
      media.each do |group, (folder, extensions, fetch)|
        locale_dirs(folder, APPLE_NON_LOCALES).each do |locale|
          local = files(File.join(folder, locale), extensions)
          next if local.empty?
          remote_locale = localizations[locale]
          if remote_locale.nil?
            report.compare(group, "ios/#{locale}", false, 'locale missing in the store')
            next
          end
          remote = fetch.call(remote_locale)
          remote.each { |item| report.processing("ios/#{locale}/#{item.file_name}", item.asset_delivery_state['state']) unless item.asset_delivery_state['state'] == 'COMPLETE' }
          local.each do |file|
            name = File.basename(file)
            match = remote.find { |item| item.file_name == name }
            report.compare(group, "ios/#{locale}/#{name}", !match.nil? && match.source_file_checksum == Digest::MD5.file(file).hexdigest,
                           match.nil? ? 'not in the store' : 'differs from the store')
          end
          (remote.map(&:file_name) - local.map { |f| File.basename(f) }).each { |name| report.problem("ios/#{locale}/#{name}", 'in the store but not in the local folder') }
        end
      end
    end
    report.finish("App Store Connect (version #{version.version_string}, #{version.app_store_state})")
  end
end
