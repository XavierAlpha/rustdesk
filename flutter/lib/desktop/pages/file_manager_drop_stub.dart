import 'package:cross_file/cross_file.dart';
import 'package:flutter_hbb/models/file_model.dart';

Future<SelectedItems> buildDroppedItems(List<XFile> files,
    {required bool isLocal}) async {
  return SelectedItems(isLocal: isLocal);
}
