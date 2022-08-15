from django import forms

from .models import Event, Hall


class EventForm(forms.ModelForm):
    class Meta:
        model = Event
        fields = '__all__'

class HallForm(forms.ModelForm):
    class Meta:
        model = Hall
        fields = '__all__'

class DateForm(forms.Form):
    date = forms.DateTimeField(
        input_formats=['%d/%m/%Y %H:%M']
    )