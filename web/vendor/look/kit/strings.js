// Add keys to BOTH dictionaries; a missing key falls back to en, then to the key itself.
export const dict = {
  en: {
    undo: "Undo", redo: "Redo", save: "Save to file", open: "Open file", settings: "Settings", back: "Back",
    theme: "Theme", system: "System", light: "Light", dark: "Dark", language: "Language", density: "Density",
    comfortable: "Comfortable", compact: "Compact", appearance: "Appearance", yourPick: "your pick", resetLook: "Reset to my picks",
    palette: "Command palette", shortcuts: "Keyboard shortcuts",
    addList: "New list", addItem: "Add item", edit: "Edit", delete: "Delete", moveUp: "Move up", moveDown: "Move down",
    reorder: "Drag to reorder (Alt+↑/↓)", empty: "Nothing here yet", emptyHint: "Add the first one above.", loading: "Loading…",
    retry: "Retry", error: "Something went wrong", deleted: "Deleted", saved: "Saved", loaded: "File loaded", loadFailed: "Could not open file",
    collapse: "Collapse", expand: "Expand", overview: "Overview", signOut: "Sign out", signIn: "Sign in", name: "Name",
    typeCommand: "Type a command…", noMatch: "No match", dataSection: "Data", resetData: "Reset to sample data",
    cancel: "Cancel", search: "Search", hex: "Hex colour", prev: "Previous", next: "Next", today: "Today",
    st_saved: "Saved", st_saving: "Saving…", st_error: "Not saved", st_dirty: "Unsaved changes", dropFile: "Drop a file",
    orClick: "or click to choose", sort: "Sort", filter: "Filter", nOfM: "{n} of {m}", resize: "Resize panel",
    resizeTip: "Drag to resize · double-click to reset", rename: "Rename", duplicate: "Duplicate", copySuffix: "(copy)",
    tableClearSort: "Back to original order", tableSortedNoReorder: "Clear the sort to reorder",
    selected: "{n} selected", selectAll: "Select all", clearSel: "Clear selection", itemsN: "{n} items", deletedN: "Deleted {n} items",
    components: "Components", componentsHelp: "Every picked control in one place. Copy from here, then delete this tab.",
    buttons: "Buttons", saveBusy: "Save", pickers: "Pickers", size: "Size", fruit: "Fruit", colour: "Colour", day: "Day",
    month: "Month", toggles: "On/off vs. select", notifications: "Notifications", filterList: "Search, sort, filter",
    mixedTitle: "Editing several items", status: "Status", mixed: "Mixed", importTitle: "Import", irreversible: "Irreversible actions",
    confirmTitle: "Delete “notes.json”?", confirmText: "This removes the file from disk. It can't be undone.", deleteFile: "Delete file…",
    advanced: "Advanced", exactColour: "Exact colour", openList: "Open list",
  },
  tr: {
    undo: "Geri al", redo: "Yinele", save: "Dosyaya kaydet", open: "Dosya aç", settings: "Ayarlar", back: "Geri",
    theme: "Tema", system: "Sistem", light: "Açık", dark: "Koyu", language: "Dil", density: "Yoğunluk",
    comfortable: "Rahat", compact: "Sıkı", appearance: "Görünüm", yourPick: "seçimin", resetLook: "Seçimlerime dön",
    palette: "Komut paleti", shortcuts: "Klavye kısayolları",
    addList: "Yeni liste", addItem: "Öğe ekle", edit: "Düzenle", delete: "Sil", moveUp: "Yukarı taşı", moveDown: "Aşağı taşı",
    reorder: "Sürükleyip sırala (Alt+↑/↓)", empty: "Henüz bir şey yok", emptyHint: "İlkini yukarıdan ekle.", loading: "Yükleniyor…",
    retry: "Tekrar dene", error: "Bir şeyler ters gitti", deleted: "Silindi", saved: "Kaydedildi", loaded: "Dosya yüklendi", loadFailed: "Dosya açılamadı",
    collapse: "Daralt", expand: "Genişlet", overview: "Genel bakış", signOut: "Çıkış yap", signIn: "Giriş yap", name: "Ad",
    typeCommand: "Komut yaz…", noMatch: "Eşleşme yok", dataSection: "Veri", resetData: "Örnek veriye sıfırla",
    cancel: "Vazgeç", search: "Ara", hex: "Hex renk", prev: "Önceki", next: "Sonraki", today: "Bugün",
    st_saved: "Kaydedildi", st_saving: "Kaydediliyor…", st_error: "Kaydedilemedi", st_dirty: "Kaydedilmemiş değişiklik", dropFile: "Dosyayı bırak",
    orClick: "ya da seçmek için tıkla", sort: "Sırala", filter: "Filtrele", nOfM: "{m} içinden {n}", resize: "Paneli boyutlandır",
    resizeTip: "Boyutlandırmak için sürükle · sıfırlamak için çift tıkla", rename: "Yeniden adlandır", duplicate: "Çoğalt", copySuffix: "(kopya)",
    tableClearSort: "Özgün sıraya dön", tableSortedNoReorder: "Sıralamak için önce sıralamayı kaldır",
    selected: "{n} seçili", selectAll: "Tümünü seç", clearSel: "Seçimi temizle", itemsN: "{n} öğe", deletedN: "{n} öğe silindi",
    components: "Bileşenler", componentsHelp: "Seçilen tüm kontroller tek yerde. Buradan kopyala, sonra bu sekmeyi sil.",
    buttons: "Düğmeler", saveBusy: "Kaydet", pickers: "Seçiciler", size: "Boyut", fruit: "Meyve", colour: "Renk", day: "Gün",
    month: "Ay", toggles: "Aç/kapa ve seçim", notifications: "Bildirimler", filterList: "Ara, sırala, filtrele",
    mixedTitle: "Birden çok öğeyi düzenleme", status: "Durum", mixed: "Karışık", importTitle: "İçe aktar", irreversible: "Geri alınamayan işlemler",
    confirmTitle: "“notes.json” silinsin mi?", confirmText: "Dosya diskten silinir. Geri alınamaz.", deleteFile: "Dosyayı sil…",
    advanced: "Gelişmiş", exactColour: "Tam renk", openList: "Listeyi aç",
  },
};

export function translate(lang, key, vars) {
  let s = dict[lang]?.[key] ?? dict.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// An app's own strings, merged over the kit's (setupLook(config, dict) calls this).
export function extendDict(more) {
  for (const [lang, keys] of Object.entries(more)) dict[lang] = { ...dict[lang], ...keys };
}
