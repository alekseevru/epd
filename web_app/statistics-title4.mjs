export function isCarrierTitle4Signed(flow) {
  return (flow?.Docflow?.Titles || []).some(title =>
    Number(title.TitleIndex) === 3 && title.AuthorSigning?.IsFinished === true
  );
}
