const utf8decode = (data) => {
  const extraByteMap = [1, 1, 1, 1, 2, 2, 3, 0];
  var count = data.length;
  var str = '';
  for (var index = 0; index < count; ) {
    var ch = data[index++];
    if (ch & 0x80) {
      var extra = extraByteMap[(ch >> 3) & 0x07];
      if (!(ch & 0x40) || !extra || index + extra > count) return null;
      ch = ch & (0x3f >> extra);
      for (; extra > 0; extra -= 1) {
        var chx = data[index++];
        if ((chx & 0xc0) !== 0x80) return null;
        ch = (ch << 6) | (chx & 0x3f);
      }
    }
    str += String.fromCharCode(ch);
  }
  return str;
};

export default utf8decode;
