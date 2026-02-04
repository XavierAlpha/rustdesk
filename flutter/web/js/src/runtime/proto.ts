import * as protobuf from 'protobufjs/minimal';
import messageSchema from '../proto/message.json';
import rendezvousSchema from '../proto/rendezvous.json';

export type ProtoRoots = {
  message: protobuf.Root;
  rendezvous: protobuf.Root;
  messageType: protobuf.Type;
  rendezvousType: protobuf.Type;
  idPkType: protobuf.Type;
};

export async function loadProtos(): Promise<ProtoRoots> {
  const messageRoot = protobuf.Root.fromJSON(
    messageSchema as protobuf.INamespace
  );
  const rendezvousRoot = protobuf.Root.fromJSON(
    rendezvousSchema as protobuf.INamespace
  );
  const messageType = messageRoot.lookupType('hbb.Message') as protobuf.Type;
  const rendezvousType = rendezvousRoot.lookupType(
    'hbb.RendezvousMessage'
  ) as protobuf.Type;
  const idPkType = messageRoot.lookupType('hbb.IdPk') as protobuf.Type;
  return {
    message: messageRoot,
    rendezvous: rendezvousRoot,
    messageType,
    rendezvousType,
    idPkType
  };
}
