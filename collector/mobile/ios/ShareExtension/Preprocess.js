// Safari supplies its actual document title, selected text and URL. No rewriting,
// page mutation, network access or document-body scraping.
var ExtensionPreprocessingJS = {
  run: function (args) {
    args.completionFunction({
      title: document.title,
      text: window.getSelection ? window.getSelection().toString() : "",
      url: document.location.href
    });
  }
};
