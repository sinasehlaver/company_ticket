from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('hall/', views.hall_index, name='hall_index'),
    path('hall/<int:hall_id>/', views.get_hall, name='get_hall'),
    path('event/', views.event_index, name='event_index'),
    path('event/<int:event_id>/', views.get_event, name='get_event'),
    path('event/add/', views.create_event, name='create_event'),
    path('event/<int:event_id>/add', views.create_day, name='create_day'),
    path('day/<int:day_id>/', views.get_day, name='get_day'),
    path('day/<int:day_id>/click/<int:ticket_id>/', views.reserve_toggle, name='reserve_toggle')

]