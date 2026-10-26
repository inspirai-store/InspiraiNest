import SwiftUI

struct NativeSearchResultRow: View {
  let entry: ReadEntry
  let query: String
  let favorite: Bool
  let selected: Bool
  @Environment(\.colorScheme) private var scheme
  @Environment(\.dynamicTypeSize) private var type
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  private var match: ReadMatch? { entry.matches?.first }
  var body: some View {
    Group {
      if type.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 10) {
          NativeText(entry.title, size: 17, bold: true, lineHeight: 23)
            .accessibilityIdentifier("review.library.title.\(entry.id)")
          highlightedSnippet.accessibilityIdentifier("review.library.summary.\(entry.id)")
          if let match { NativeText(match.location, size: 12).foregroundStyle(p.secondary) }
          NativeText("\(entry.dateLabel)  ·  \(entry.typeLabel)", size: 12).foregroundStyle(
            p.secondary)
          NativeText(entry.statusLabel, size: 12).foregroundStyle(p.accent)
        }.padding(.leading, 52).padding(.trailing, 40).padding(.vertical, 17)
      } else {
        NativeSearchResultLayout(scale: scale) {
          NativeText(entry.title, size: 17, bold: true, lineHeight: 23)
            .accessibilityIdentifier("review.library.title.\(entry.id)")
          highlightedSnippet.accessibilityIdentifier("review.library.summary.\(entry.id)")
          NativeText(match?.location ?? "", size: 12).foregroundStyle(p.secondary)
            .accessibilityIdentifier("review.library.location.\(entry.id)")
          NativeText("\(entry.dateLabel)  ·  \(entry.typeLabel)", size: 12).foregroundStyle(
            p.secondary
          ).accessibilityIdentifier("review.library.date.\(entry.id)")
          NativeText(entry.statusLabel, size: 12).foregroundStyle(p.accent)
            .accessibilityIdentifier("review.library.state.\(entry.id)")
        }
      }
    }.background {
      if selected {
        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.selection).padding(
          .horizontal, 8
        ).padding(.bottom, 5)
      }
    }
    .overlay(alignment: .topLeading) {
      NativeGlyph(name: "file").foregroundStyle(p.accent).padding(.leading, 16).padding(.top, 18)
    }
    .overlay(alignment: .topTrailing) {
      NativeGlyph(name: "bookmark", size: 18).foregroundStyle(favorite ? p.accent : p.secondary)
        .padding(.trailing, 12).padding(.top, 19)
    }
    .overlay(alignment: .bottom) {
      Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 52).padding(.trailing, 16)
        .offset(y: 1)
    }
    .contentShape(Rectangle()).accessibilityElement(children: .combine)
  }
  @ViewBuilder private var highlightedSnippet: some View {
    let text = match?.snippet ?? entry.summary ?? ""
    let needle = query.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
    if !needle.isEmpty,
      let range = text.range(of: needle, options: [.caseInsensitive, .widthInsensitive]),
      range.lowerBound == text.startIndex, !type.isAccessibilitySize, text.count <= 22
    {
      HStack(alignment: .top, spacing: 0) {
        NativeText(String(text[range]), size: 14, bold: true).fixedSize().foregroundStyle(p.accent)
        NativeText(
          String(text[range.upperBound...]), size: 14, lineHeight: 20, explicitLineWidth: 500
        ).foregroundStyle(
          p.secondary)
      }.accessibilityLabel(text)
    } else {
      Text(highlighted(type.isAccessibilitySize ? text : excerpt(text), needle: needle)).font(
        .system(size: 14 * scale)
      ).foregroundStyle(
        p.secondary
      ).lineLimit(type.isAccessibilitySize ? nil : 1).accessibilityLabel(text)
    }
  }
  private func excerpt(_ text: String) -> String {
    guard text.count > 22, let range = LibrarySearchHighlight.ranges(in: text, query: query).first
    else { return text }
    let start =
      text.index(range.lowerBound, offsetBy: -8, limitedBy: text.startIndex) ?? text.startIndex
    let end = text.index(range.upperBound, offsetBy: 16, limitedBy: text.endIndex) ?? text.endIndex
    return (start > text.startIndex ? "…" : "") + String(text[start..<end])
      + (end < text.endIndex ? "…" : "")
  }
  private func highlighted(_ value: String, needle: String) -> AttributedString {
    var result = AttributedString(value)
    guard !needle.isEmpty else { return result }
    for range in LibrarySearchHighlight.ranges(in: value, query: query) {
      if let converted = Range(range, in: result) {
        result[converted].foregroundColor = p.accent
        result[converted].font = .system(size: 14 * scale, weight: .bold)
      }
    }
    return result
  }
}

private struct NativeSearchResultLayout: Layout {
  let scale: CGFloat
  private func measurements(_ width: CGFloat, _ subviews: Subviews) -> (
    sizes: [CGSize], positions: [CGPoint], height: CGFloat
  ) {
    let title = subviews[0].sizeThatFits(.init(width: max(1, width - 91), height: nil))
    let snippet = subviews[1].sizeThatFits(.init(width: max(1, width - 72), height: nil))
    let location = subviews[2].sizeThatFits(.init(width: max(1, width - 72), height: nil))
    let status = subviews[4].sizeThatFits(.unspecified)
    let availableDateWidth = max(1, width - 68 - status.width - 8)
    let stacked = scale > 1.001
      || subviews[3].sizeThatFits(.unspecified).width > availableDateWidth
    let date = subviews[3].sizeThatFits(
      .init(width: stacked ? max(1, width - 68) : availableDateWidth, height: nil))
    let flows = scale > 1.001 || stacked || title.height > 48
      || snippet.height > 23 || location.height > 25
    let snippetY = flows ? max(65, 17 + title.height + 10) : 65
    let locationY = flows ? max(88, snippetY + snippet.height + 8) : 88
    let footerY = flows ? max(113, locationY + location.height + 8) : 113
    let footerHeight = stacked ? date.height + 8 + status.height : max(date.height, status.height)
    return (
      [title, snippet, location, date, status],
      [.init(x: 52, y: 17), .init(x: 52, y: snippetY), .init(x: 52, y: locationY),
       .init(x: 52, y: footerY),
       .init(x: stacked ? 52 : width - 16 - status.width,
             y: stacked ? footerY + date.height + 8 : footerY)],
      flows ? max(138, footerY + footerHeight + 12) : 138)
  }
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 393
    return .init(width: width, height: measurements(width, subviews).height)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let m = measurements(bounds.width, subviews)
    for index in subviews.indices {
      subviews[index].place(
        at: .init(x: bounds.minX + m.positions[index].x, y: bounds.minY + m.positions[index].y),
        anchor: .topLeading,
        proposal: .init(width: m.sizes[index].width, height: m.sizes[index].height))
    }
  }
}
