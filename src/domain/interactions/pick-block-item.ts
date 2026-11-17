import { BLOCK_TYPES, itemOfBlock, type BlockType, type ItemType } from '@nerima-games/mc-kernel'
import { Schema, SchemaParser } from 'effect'

export type PickBlockTarget =
  | Readonly<{ block: Exclude<BlockType, 'piston_head'> }>
  | Readonly<{ block: 'piston_head'; pistonHeadType: 'normal' | 'sticky' }>

const ordinaryBlocks = BLOCK_TYPES.filter(
  (block): block is Exclude<BlockType, 'piston_head'> => block !== 'piston_head',
)
const targetSchema = Schema.Union([
  Schema.Struct({ block: Schema.Literals(ordinaryBlocks) }),
  Schema.Struct({
    block: Schema.Literal('piston_head'),
    pistonHeadType: Schema.Literals(['normal', 'sticky']),
  }),
])

export const GameplayPickBlockTargetSchema: Schema.Codec<PickBlockTarget, unknown> =
  Schema.declareConstructor<PickBlockTarget, unknown>()([targetSchema], ([inner]) =>
    (input, _ast, options) => SchemaParser.decodeUnknownEffect(inner)(input, {
      ...options,
      onExcessProperty: 'error',
    }),
  )

// mc-kernel follow-up: move pick mappings beside block-item; placement mappings
// intentionally omit state-only blocks and crop planting items.
const PICK_ITEM_BY_BLOCK: Readonly<Partial<Record<Exclude<BlockType, 'piston_head'>, ItemType>>> = {
  door_open: 'door',
  redstone_lamp_lit: 'redstone_lamp',
  redstone_wall_torch: 'redstone_torch',
  wheat_crop: 'wheat_seeds',
  potato_crop: 'potato',
  nether_wart_crop: 'nether_wart',
}

export const itemForPickedBlock = (target: PickBlockTarget): ItemType | undefined => {
  if (target.block === 'piston_head') {
    return target.pistonHeadType === 'sticky' ? 'sticky_piston' : 'piston'
  }
  const item = PICK_ITEM_BY_BLOCK[target.block]
  if (item !== undefined) return item
  return itemOfBlock(target.block)
}
