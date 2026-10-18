package store.inspirai.library.nativeui.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object NestSpace { val page = 20.dp; val gap = 12.dp; val section = 24.dp; val reader = 720.dp }
private val Day = lightColorScheme(primary=Color(0xFFB45309), onPrimary=Color.White,
    primaryContainer=Color(0xFFFFE9CB),onPrimaryContainer=Color(0xFF703800),
    secondary=Color(0xFFA85705),onSecondary=Color.White,secondaryContainer=Color(0xFFF1E7D8),onSecondaryContainer=Color(0xFF493922),
    tertiary=Color(0xFF756044),tertiaryContainer=Color(0xFFF0E4D2),onTertiaryContainer=Color(0xFF493922),
    surfaceTint=Color(0xFFB45309),surfaceContainerLowest=Color.White,surfaceContainerLow=Color(0xFFF6F5F1),
    surfaceContainer=Color(0xFFF1EFE9),surfaceContainerHigh=Color(0xFFECEAE4),surfaceContainerHighest=Color(0xFFE7E5DE),
    background=Color(0xFFF6F5F1), surface=Color.White,
    surfaceVariant=Color(0xFFECEAE4), onSurface=Color(0xFF1C1C1E), onBackground=Color(0xFF1C1C1E),
    onSurfaceVariant=Color(0xFF6C6C70),outline=Color(0xFF827E75),outlineVariant=Color(0xFFE5E3DD),
    inverseSurface=Color(0xFF30302C),inverseOnSurface=Color(0xFFF6F5F1),inversePrimary=Color(0xFFF2A33A))
private val Night = darkColorScheme(primary=Color(0xFFF2A33A), onPrimary=Color(0xFF261A09),
    primaryContainer=Color(0xFF553A1A),onPrimaryContainer=Color(0xFFFFDCAA),
    secondary=Color(0xFFF2A33A),onSecondary=Color(0xFF261A09),secondaryContainer=Color(0xFF403628),onSecondaryContainer=Color(0xFFF1DDC0),
    tertiary=Color(0xFFD5C0A2),tertiaryContainer=Color(0xFF403628),onTertiaryContainer=Color(0xFFF1DDC0),
    surfaceTint=Color(0xFFF2A33A),surfaceContainerLowest=Color(0xFF161615),surfaceContainerLow=Color(0xFF1C1C1A),
    surfaceContainer=Color(0xFF232321),surfaceContainerHigh=Color(0xFF2E2E2A),surfaceContainerHighest=Color(0xFF363630),
    background=Color(0xFF161615), surface=Color(0xFF232321),
    surfaceVariant=Color(0xFF2E2E2A), onSurface=Color(0xFFF4F2EC), onBackground=Color(0xFFF4F2EC),
    onSurfaceVariant=Color(0xFFABA9A2),outline=Color(0xFF8F8B82),outlineVariant=Color(0xFF393935),
    inverseSurface=Color(0xFFF6F5F1),inverseOnSurface=Color(0xFF232321),inversePrimary=Color(0xFFB45309))

@Composable fun NestTheme(mode: String, content: @Composable () -> Unit) {
    val dark = mode == "dark" || (mode == "system" && isSystemInDarkTheme())
    MaterialTheme(colorScheme=if(dark) Night else Day,
        shapes=Shapes(extraSmall=RoundedCornerShape(12.dp),small=RoundedCornerShape(12.dp),medium=RoundedCornerShape(16.dp),large=RoundedCornerShape(16.dp),extraLarge=RoundedCornerShape(24.dp)),
        typography=Typography(
            headlineLarge=TextStyle(fontSize=32.sp, lineHeight=40.sp, fontWeight=FontWeight.Bold),
            titleLarge=TextStyle(fontSize=22.sp, lineHeight=30.sp, fontWeight=FontWeight.SemiBold),
            titleMedium=TextStyle(fontSize=17.sp, lineHeight=25.sp, fontWeight=FontWeight.SemiBold),
            bodyLarge=TextStyle(fontSize=18.sp, lineHeight=30.sp),
            bodyMedium=TextStyle(fontSize=15.sp, lineHeight=24.sp),
            labelLarge=TextStyle(fontSize=14.sp, lineHeight=20.sp, fontWeight=FontWeight.Medium)), content=content)
}

@Composable fun EmptyState(title: String, action: String?=null, onAction: ()->Unit={}) {
    Column(Modifier.fillMaxWidth().padding(vertical=48.dp), verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text(title, style=MaterialTheme.typography.titleMedium, color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(action!=null) OutlinedButton(onClick=onAction) { Text(action) }
    }
}
@Composable fun ErrorState(message: String, retry: ()->Unit) {
    Surface(color=MaterialTheme.colorScheme.errorContainer, shape=MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(message, color=MaterialTheme.colorScheme.onErrorContainer)
            TextButton(onClick=retry) { Text("重试") }
        }
    }
}
